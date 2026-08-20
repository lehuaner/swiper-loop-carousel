// 删除"吸入"动画的后台线程脚本（Blob 内联 Worker 源码）。
// 把原主线程 rAF 逐帧的网格三角纹理映射动画搬到 Web Worker + OffscreenCanvas 渲染，
// 主线程只需 postMessage 一次纹理/几何，之后每帧绘制都在独立线程完成 → 动画不再被主线程
// 长任务（删除点击处理、460ms 重排 commit 等，trace 中 ~32ms JS 长任务）抢占，掉帧根治，
// 视觉与之前完全一致。
// 注意：该源码以字符串内联（避免 tsup splitting:false/Next 打包额外 worker 文件的负担），
// 因此内部不得出现反引号与 ${（已用字符串拼接代替模板字面量）。
export const suctionWorkerSource = `
var TINY = 0.05;
var FLAT = 0.55;
function easeInOut(t){ return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; }

self.onmessage = function (ev) {
  var d = ev.data;
  if (d.type !== 'init') return;
  var card = d.card;
  var cols = card.cols, rows = card.rows;
  var target = d.target;
  var tex = d.texture;
  var tw = tex.width, th = tex.height;
  var ctx = d.canvas.getContext('2d');
  ctx.scale(d.dpr, d.dpr);
  ctx.translate(-d.minX, -d.minY);

  var vertices = [], origVertices = [];
  for (var r = 0; r <= rows; r++) {
    var vr = [], or0 = [];
    for (var c = 0; c <= cols; c++) {
      vr.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
      or0.push({ x: card.x + (c / cols) * card.w, y: card.y + (r / rows) * card.h });
    }
    vertices.push(vr); origVertices.push(or0);
  }

  var corners = [[0,0],[cols,0],[0,rows],[cols,rows]];
  var startCol = 0, startRow = 0, bestD = Infinity;
  for (var i = 0; i < corners.length; i++) {
    var ox = card.x + (corners[i][0]/cols)*card.w;
    var oy = card.y + (corners[i][1]/rows)*card.h;
    var di = Math.hypot(ox - target.x, oy - target.y);
    if (di < bestD) { bestD = di; startCol = corners[i][0]; startRow = corners[i][1]; }
  }
  var maxCornerDist = Math.hypot(cols, rows);
  var frontDist = [];
  for (var r2 = 0; r2 <= rows; r2++) {
    frontDist[r2] = [];
    for (var c2 = 0; c2 <= cols; c2++) {
      frontDist[r2][c2] = Math.min(1, Math.hypot(c2 - startCol, r2 - startRow) / maxCornerDist);
    }
  }

  function updateVertices(progress) {
    var tx = target.x, ty = target.y;
    var TCx = card.x + card.w / 2, TCy = card.y + card.h / 2;
    var SPEED_K = 2.4;
    for (var r = 0; r <= rows; r++) {
      var fd = frontDist[r], vr0 = vertices[r], or1 = origVertices[r];
      for (var c = 0; c <= cols; c++) {
        var o = or1[c];
        var d0 = fd[c];
        var sp = 1 + (1 - d0) * (SPEED_K - 1);
        var lp = progress * sp; lp = lp < 0 ? 0 : lp > 1 ? 1 : lp; lp = easeInOut(lp);
        var nx = tx + (o.x - TCx) * TINY;
        var ny = ty + (o.y - TCy) * TINY * FLAT;
        var v = vr0[c];
        v.x = o.x + (nx - o.x) * lp;
        v.y = o.y + (ny - o.y) * lp;
      }
    }
  }

  function drawTexTri(sx0,sy0,sx1,sy1,sx2,sy2,dx0,dy0,dx1,dy1,dx2,dy2) {
    var denom = (sx1-sx0)*(sy2-sy0)-(sy1-sy0)*(sx2-sx0) || 1e-6;
    var m11 = ((dx1-dx0)*(sy2-sy0)-(dx2-dx0)*(sy1-sy0))/denom;
    var m12 = ((dx2-dx0)*(sx1-sx0)-(dx1-dx0)*(sx2-sx0))/denom;
    var m21 = ((dy1-dy0)*(sy2-sy0)-(dy2-dy0)*(sy1-sy0))/denom;
    var m22 = ((dy2-dy0)*(sx1-sx0)-(dy1-dy0)*(sx2-sx0))/denom;
    var mtx = dx0-(m11*sx0+m12*sy0);
    var mty = dy0-(m21*sx0+m22*sy0);
    var PAD = 1.5;
    var cx = (dx0+dx1+dx2)/3, cy = (dy0+dy1+dy2)/3;
    function expand(vx,vy){ var ex=vx-cx, ey=vy-cy, l=Math.hypot(ex,ey)||1; return [vx+(ex/l)*PAD, vy+(ey/l)*PAD]; }
    var a=expand(dx0,dy0), bb=expand(dx1,dy1), cc=expand(dx2,dy2);
    var ssx=Math.max(0,Math.min(sx0,sx1,sx2)-1);
    var ssy=Math.max(0,Math.min(sy0,sy1,sy2)-1);
    var ssw=Math.min(tw,Math.max(sx0,sx1,sx2)+1)-ssx;
    var ssh=Math.min(th,Math.max(sy0,sy1,sy2)+1)-ssy;
    ctx.save(); ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(bb[0],bb[1]); ctx.lineTo(cc[0],cc[1]); ctx.closePath(); ctx.clip();
    ctx.transform(m11,m21,m12,m22,mtx,mty);
    ctx.drawImage(tex, ssx,ssy,ssw,ssh, ssx,ssy,ssw,ssh);
    ctx.restore();
  }

  function drawCardMesh(progress) {
    var k = Math.pow(1 - progress, 1.6) * 0.95 + 0.05;
    var dark = 1 - (0.55 + 0.45 * k);
    ctx.save();
    ctx.beginPath(); ctx.moveTo(vertices[0][0].x, vertices[0][0].y);
    for (var c=1;c<=cols;c++) ctx.lineTo(vertices[0][c].x, vertices[0][c].y);
    for (var r=1;r<=rows;r++) ctx.lineTo(vertices[r][cols].x, vertices[r][cols].y);
    for (var c=cols-1;c>=0;c--) ctx.lineTo(vertices[rows][c].x, vertices[rows][c].y);
    for (var r=rows-1;r>=0;r--) ctx.lineTo(vertices[r][0].x, vertices[r][0].y);
    ctx.closePath(); ctx.clip();
    for (var r=0;r<rows;r++) {
      for (var c=0;c<cols;c++) {
        var d0=vertices[r][c], d1=vertices[r][c+1], d2=vertices[r+1][c+1], d3=vertices[r+1][c];
        var s0x=(c/cols)*tw, s0y=(r/rows)*th, s1x=((c+1)/cols)*tw, s1y=s0y, s2x=s1x, s2y=((r+1)/rows)*th, s3x=s0x, s3y=s2y;
        drawTexTri(s0x,s0y,s1x,s1y,s2x,s2y,d0.x,d0.y,d1.x,d1.y,d2.x,d2.y);
        drawTexTri(s0x,s0y,s2x,s2y,s3x,s3y,d0.x,d0.y,d2.x,d2.y,d3.x,d3.y);
      }
    }
    ctx.restore();
    if (dark > 0.01) {
      ctx.save();
      ctx.beginPath(); ctx.moveTo(vertices[0][0].x, vertices[0][0].y);
      for (var c=1;c<=cols;c++) ctx.lineTo(vertices[0][c].x, vertices[0][c].y);
      for (var r=1;r<=rows;r++) ctx.lineTo(vertices[r][cols].x, vertices[r][cols].y);
      for (var c=cols-1;c>=0;c--) ctx.lineTo(vertices[rows][c].x, vertices[rows][c].y);
      for (var r=rows-1;r>=0;r--) ctx.lineTo(vertices[r][0].x, vertices[r][0].y);
      ctx.closePath(); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,' + dark + ')';
      ctx.fill();
      ctx.restore();
    }
  }

  var w0 = performance.now();
  var dur = d.durationMs;
  var timer = null;
  function loop() {
    var progress = Math.min(1, (performance.now() - w0) / dur);
    ctx.clearRect(d.minX, d.minY, d.boxW, d.boxH);
    updateVertices(progress);
    drawCardMesh(progress);
    if (progress < 1) timer = setTimeout(loop, 0);
    else self.postMessage({ type: 'done' });
  }
  loop();
};
`;