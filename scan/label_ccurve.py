"""
label_ccurve.py
---------------
C-curve 정답(ground truth) 라벨링 도구. 사이드뷰 사진마다 손톱의
  1) 왼쪽 끝  2) 호의 꼭대기  3) 오른쪽 끝
을 클릭해서 저장한다. 저장된 좌표는 알고리즘이 얼마나 어긋나는지 재는 기준이 된다.

실행 (저장소 루트에서):
    venv\\Scripts\\python scan\\label_ccurve.py
그다음 브라우저에서 http://localhost:8765 를 연다. 사진은 이 PC 밖으로 나가지 않는다.

결과 파일: scan/ccurve_labels.json  (좌표는 원본 사진 픽셀 기준)
"""

import json
import os
import re
import sys
import glob
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import cv2
import numpy as np

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PHOTOS = os.path.join(BASE, "photos")
RESULTS = os.path.join(BASE, "results")
LABELS = os.path.join(os.path.dirname(__file__), "ccurve_labels.json")
PORT = 8765

# 손가락이 항상 아치 구멍 근처에 오므로 그 부분만 잘라서 보여준다 (원본 픽셀 기준).
CROP = (1100, 1650, 2050, 2300)   # x0, y0, x1, y1

_lock = threading.Lock()


def _load_labels():
    if os.path.isfile(LABELS):
        try:
            with open(LABELS, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": 1, "crop": list(CROP), "labels": {}}


def _save_labels(data):
    tmp = LABELS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, LABELS)


def _items():
    out = []
    pat = re.compile(r"photos[\\/](\d+)[\\/](\d+)[\\/](left|right)[\\/](\w+?)_side\.jpg$")
    for p in sorted(glob.glob(os.path.join(PHOTOS, "*", "*", "*", "*_side.jpg"))):
        m = pat.search(os.path.relpath(p, BASE).replace("\\", "/").replace("/", os.sep))
        if not m:
            m = pat.search(p)
        if not m:
            continue
        user, session, hand, finger = m.groups()
        # 고화질 촬영이 실패했을 때 서버가 저장한 저해상도 프리뷰 사진(폭 960 등)은
        # 정답 라벨용으로 쓸 수 없고 자르는 영역도 벗어나므로 목록에서 뺀다.
        small = cv2.imread(p, cv2.IMREAD_REDUCED_COLOR_8)
        if small is None or small.shape[1] * 8 < 2000:
            continue
        rel = os.path.relpath(p, BASE).replace("\\", "/")
        width = algo = None
        rj = os.path.join(RESULTS, user, session, hand, finger, "nail_measurements.json")
        if os.path.isfile(rj):
            try:
                with open(rj, encoding="utf-8") as f:
                    n = json.load(f)["nails"][0]
                width, algo = n.get("width_mm"), n.get("c_curve_mm")
            except Exception:
                pass
        out.append({"id": rel, "user": user, "session": session, "hand": hand,
                    "finger": finger, "width_mm": width, "algo_c_mm": algo})
    # 최신 세션이 먼저
    out.sort(key=lambda i: (-int(i["session"]), ["thumb", "index", "middle", "ring", "pinky"].index(i["finger"])
                            if i["finger"] in ("thumb", "index", "middle", "ring", "pinky") else 9))
    return out


def _crop_jpeg(rel, enhance):
    path = os.path.normpath(os.path.join(BASE, rel))
    if not path.startswith(PHOTOS) or not os.path.isfile(path):
        return None
    im = cv2.imread(path)
    if im is None:
        return None
    x0, y0, x1, y1 = CROP
    c = im[y0:y1, x0:x1].copy()
    if c.size == 0:
        return None
    if enhance:
        lab = cv2.cvtColor(c, cv2.COLOR_BGR2Lab)
        lab[..., 0] = cv2.createCLAHE(2.5, (4, 4)).apply(lab[..., 0])
        c = cv2.cvtColor(lab, cv2.COLOR_Lab2BGR)
    ok, buf = cv2.imencode(".jpg", c, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return buf.tobytes() if ok else None


def _metrics(points):
    (lx, ly), (px, py), (rx, ry) = points
    dx, dy = rx - lx, ry - ly
    chord = float(np.hypot(dx, dy))
    if chord < 1:
        return None
    # 꼭대기에서 양 끝을 이은 선까지의 수직 거리
    sag = abs(dx * (ly - py) - (lx - px) * dy) / chord
    return {"chord_px": round(chord, 1), "sag_px": round(sag, 1), "ratio": round(sag / chord, 4)}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            self._send(200, PAGE.encode("utf-8"), "text/html; charset=utf-8")
        elif u.path == "/api/list":
            with _lock:
                data = _load_labels()
            items = _items()
            for it in items:
                it["label"] = data["labels"].get(it["id"])
            body = json.dumps({"crop": CROP, "items": items}, ensure_ascii=False).encode("utf-8")
            self._send(200, body, "application/json; charset=utf-8")
        elif u.path == "/api/img":
            rel = (q.get("id") or [""])[0]
            jpg = _crop_jpeg(rel, (q.get("enh") or ["0"])[0] == "1")
            if jpg is None:
                self._send(404, b"not found", "text/plain")
            else:
                self._send(200, jpg, "image/jpeg")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if urlparse(self.path).path != "/api/label":
            self._send(404, b"not found", "text/plain")
            return
        n = int(self.headers.get("Content-Length", "0"))
        req = json.loads(self.rfile.read(n).decode("utf-8"))
        rid, pts = req.get("id"), req.get("points")
        with _lock:
            data = _load_labels()
            if pts is None:
                data["labels"].pop(rid, None)
            else:
                m = _metrics(pts)
                if m is None:
                    self._send(400, b"bad points", "text/plain")
                    return
                data["labels"][rid] = {"points": pts, **m, "skip": False,
                                       "at": datetime.now().isoformat(timespec="seconds")}
            data["crop"] = list(CROP)
            _save_labels(data)
        self._send(200, b'{"ok":true}', "application/json")


PAGE = r"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>C-curve 라벨링</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;background:#16181c;color:#e8e8e8;font-family:system-ui,"Malgun Gothic",sans-serif}
  #top{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#20242b;position:sticky;top:0;z-index:5}
  #top b{font-size:17px}
  button{background:#3a4150;color:#fff;border:0;border-radius:6px;padding:7px 13px;font-size:14px;cursor:pointer}
  button:hover{background:#4b5468} button.pri{background:#2f7d4f} button.warn{background:#8a3d3d}
  #wrap{padding:10px 16px}
  canvas{display:block;cursor:crosshair;border:1px solid #444;max-width:100%}
  #hint{padding:8px 16px;color:#ffd866;font-size:15px}
  #info{padding:0 16px 14px;font-size:14px;line-height:1.7;color:#cfd6e4}
  .tag{display:inline-block;padding:2px 8px;border-radius:10px;font-size:12px;margin-left:6px}
  .done{background:#2f7d4f}.todo{background:#6a6f7a}
  kbd{background:#333;border-radius:4px;padding:1px 6px}
</style></head><body>
<div id="top">
  <b id="title">불러오는 중…</b><span id="prog"></span>
  <button onclick="go(-1)">◀ 이전 (P)</button>
  <button class="pri" onclick="next()">저장하고 다음 ▶ (Enter)</button>
  <button onclick="undo()">되돌리기 (Backspace)</button>
  <button class="warn" onclick="clearLabel()">라벨 지우기 (C)</button>
  <button onclick="toggleEnh()" id="enhBtn">밝기 보정 ON/OFF (E)</button>
  <button onclick="go(1)">건너뛰기 ▶ (S)</button>
</div>
<div id="hint"></div>
<div id="wrap"><canvas id="cv"></canvas></div>
<div id="info"></div>
<script>
let items=[], crop=[0,0,1,1], idx=0, pts=[], enh=false, img=new Image(), scale=1;
const cv=document.getElementById('cv'), ctx=cv.getContext('2d');
const STEPS=['① 손톱의 왼쪽 끝을 클릭','② 손톱 호의 가장 높은 지점(꼭대기)을 클릭','③ 손톱의 오른쪽 끝을 클릭','✔ 3점 완료 — Enter 로 저장하고 다음 사진'];
function metrics(p){
  const [l,t,r]=p, dx=r[0]-l[0], dy=r[1]-l[1], ch=Math.hypot(dx,dy);
  const sag=Math.abs(dx*(l[1]-t[1])-(l[0]-t[0])*dy)/ch; return {chord:ch,sag:sag,ratio:sag/ch};
}
async function load(){
  const r=await fetch('/api/list'); const d=await r.json(); items=d.items; crop=d.crop;
  const first=items.findIndex(i=>!i.label); idx=first>=0?first:0; show();
}
function show(){
  const it=items[idx]; if(!it)return;
  pts=(it.label?it.label.points:[]).map(p=>[p[0]-crop[0],p[1]-crop[1]]);
  img=new Image(); img.onload=()=>{scale=Math.min(1.35,(window.innerWidth-40)/img.width);cv.width=img.width*scale;cv.height=img.height*scale;draw();};
  img.src='/api/img?id='+encodeURIComponent(it.id)+'&enh='+(enh?1:0)+'&t='+Date.now();
  const done=items.filter(i=>i.label).length;
  document.getElementById('title').textContent=`${it.hand==='left'?'왼손':'오른손'} ${it.finger} (세션 ${it.session})`;
  document.getElementById('prog').innerHTML=`${idx+1}/${items.length} · 라벨 완료 ${done}개`;
  info();
}
function parab(l,t,r){ // x에 대한 2차식: 세 점을 지나게 (화면 좌표)
  const [x1,y1]=l,[x2,y2]=t,[x3,y3]=r; const d=(x1-x2)*(x1-x3)*(x2-x3); if(Math.abs(d)<1e-6)return null;
  const A=(x3*(y2-y1)+x2*(y1-y3)+x1*(y3-y2))/d, B=(x3*x3*(y1-y2)+x2*x2*(y3-y1)+x1*x1*(y2-y3))/d, C=(x2*x3*(x2-x3)*y1+x3*x1*(x3-x1)*y2+x1*x2*(x1-x2)*y3)/d;
  return x=>A*x*x+B*x+C;
}
function draw(){
  ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(img,0,0,cv.width,cv.height);
  const P=pts.map(p=>[p[0]*scale,p[1]*scale]);
  if(P.length===3){
    ctx.strokeStyle='#27c8ff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(...P[0]); ctx.lineTo(...P[2]); ctx.stroke();
    const f=parab(P[0],P[1],P[2]); if(f){ctx.strokeStyle='#ff3df0';ctx.lineWidth=2.5;ctx.beginPath();
      const a=Math.min(P[0][0],P[2][0]), b=Math.max(P[0][0],P[2][0]); for(let x=a;x<=b;x+=2){const y=f(x); x===a?ctx.moveTo(x,y):ctx.lineTo(x,y);} ctx.stroke();}
  }
  P.forEach((p,i)=>{ctx.fillStyle=['#00e676','#ff1744','#00e676'][i];ctx.beginPath();ctx.arc(p[0],p[1],5,0,7);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='13px sans-serif';ctx.fillText(['왼쪽 끝','꼭대기','오른쪽 끝'][i],p[0]+8,p[1]-8);});
  document.getElementById('hint').textContent=STEPS[Math.min(pts.length,3)];
}
function info(){
  const it=items[idx]; let h='';
  if(pts.length===3){
    const m=metrics(pts); h+=`호 높이/현 길이 = <b>${m.ratio.toFixed(3)}</b> (현 ${m.chord.toFixed(0)}px, 높이 ${m.sag.toFixed(0)}px)<br>`;
    if(it.width_mm) h+=`손톱 폭 ${it.width_mm}mm 기준 예상 C-curve = <b>${(m.ratio*it.width_mm).toFixed(2)}mm</b>`;
    if(it.algo_c_mm!=null) h+=` &nbsp;·&nbsp; 현재 알고리즘 값 ${Number(it.algo_c_mm).toFixed(2)}mm`;
  } else h='클릭 순서: <kbd>왼쪽 끝</kbd> → <kbd>꼭대기</kbd> → <kbd>오른쪽 끝</kbd>. 마젠타 곡선이 손톱 호를 따라가는지 보면서 점을 잡아 주세요. 점을 다시 찍으려면 Backspace.';
  h+=`<br><span class="tag ${it.label?'done':'todo'}">${it.label?'저장됨':'미저장'}</span>`;
  document.getElementById('info').innerHTML=h;
}
cv.addEventListener('click',e=>{
  if(pts.length>=3)return; const r=cv.getBoundingClientRect();
  const x=(e.clientX-r.left)*(cv.width/r.width)/scale, y=(e.clientY-r.top)*(cv.height/r.height)/scale;
  pts.push([x,y]); draw(); info();
});
function undo(){pts.pop();draw();info();}
async function save(){
  const it=items[idx]; if(pts.length!==3)return false;
  const orig=pts.map(p=>[Math.round(p[0]+crop[0]),Math.round(p[1]+crop[1])]);
  await fetch('/api/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id,points:orig})});
  const m=metrics(pts); it.label={points:orig,ratio:m.ratio}; return true;
}
async function next(){ if(pts.length===3){await save();} else if(!items[idx].label){alert('3점을 모두 찍어야 저장돼요. (건너뛰려면 S)');return;} go(1); }
async function clearLabel(){const it=items[idx]; await fetch('/api/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id,points:null})}); it.label=null; pts=[]; draw(); info(); show();}
function go(d){ idx=Math.max(0,Math.min(items.length-1,idx+d)); show(); }
function toggleEnh(){enh=!enh; const it=items[idx]; const keep=pts.slice(); img=new Image(); img.onload=()=>{draw();}; img.src='/api/img?id='+encodeURIComponent(it.id)+'&enh='+(enh?1:0)+'&t='+Date.now();}
document.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();next();} else if(e.key==='Backspace'){e.preventDefault();undo();}
  else if(e.key==='p'||e.key==='P')go(-1); else if(e.key==='s'||e.key==='S')go(1);
  else if(e.key==='e'||e.key==='E')toggleEnh(); else if(e.key==='c'||e.key==='C')clearLabel();
});
load();
</script></body></html>
"""


if __name__ == "__main__":
    if not os.path.isdir(PHOTOS):
        sys.exit(f"photos 폴더가 없습니다: {PHOTOS}")
    print(f"사진 {len(_items())}장 / 라벨 파일: {LABELS}")
    print(f"브라우저에서 http://localhost:{PORT} 를 여세요.  (끝내려면 Ctrl+C)")
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
