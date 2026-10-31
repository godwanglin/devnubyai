export interface BridgeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BridgeSelectionMessage {
  __devnubyEditSelect?: string;
  __devnubyScrollUpdate?: string;
  text?: string;
  firstText?: string;
  lastText?: string;
  htmlSnippet?: string;
  tagName?: string;
  id?: string;
  className?: string;
  src?: string;
  rect?: BridgeRect;
  visible?: boolean;
}

/**
 * Injects a visual element inspector & multi-selection overlay into raw HTML string.
 * Supports:
 * - Hover box + inspector tooltip (tagName, dimensions, color, font)
 * - Single click element select & drag marquee area select
 * - Locked blue selection box with teardrop pin badge
 * - Persistent confirmed selection boxes with numbered badges (#1, #2...)
 * - Real-time scroll synchronization via postMessage
 * - Click interception on links/buttons to prevent navigation while active
 */
export function injectSelectionBridge(rawHtml: string, token: string): string {
  const safeToken = JSON.stringify(token);
  const script = `<script>(function(){
var T=${safeToken};
var active=false;
var hoverEl=null;
var selectedEl=null;
var selectedMarquee=null;
var dragStart=null;
var dragCurrent=null;
var confirmedBoxes=[];

function parseHex(c){
  var m=c&&c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
  if(!m)return c||"";
  var r=(+m[1]).toString(16).padStart(2,"0");
  var g=(+m[2]).toString(16).padStart(2,"0");
  var b=(+m[3]).toString(16).padStart(2,"0");
  return("#"+r+g+b).toUpperCase();
}

var overlay=document.createElement("div");
overlay.id="__devnuby_overlay";
overlay.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:999999;overflow:visible;";

var hoverBox=document.createElement("div");
hoverBox.style.cssText="position:absolute;display:none;border:1.5px solid #38bdf8;background:rgba(56,189,248,0.06);border-radius:4px;pointer-events:none;";

var tooltip=document.createElement("div");
tooltip.style.cssText="position:absolute;display:none;padding:6px 10px;border-radius:8px;background:rgba(13,17,23,0.85);border:1px solid rgba(255,255,255,0.15);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,0.5);font-family:system-ui,-apple-system,sans-serif;font-size:11px;line-height:1.4;pointer-events:none;z-index:1000000;min-width:180px;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);";

var selectBox=document.createElement("div");
selectBox.style.cssText="position:absolute;display:none;border:2px solid #0084ff;background:rgba(0,132,255,0.08);border-radius:4px;pointer-events:none;z-index:999998;";

var pinBadge=document.createElement("div");
pinBadge.style.cssText="position:absolute;top:-10px;right:-10px;width:20px;height:20px;background:#0084ff;border-radius:9999px 9999px 2px 9999px;transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,132,255,0.5);";
selectBox.appendChild(pinBadge);

var marqueeBox=document.createElement("div");
marqueeBox.style.cssText="position:absolute;display:none;border:1.5px dashed #38bdf8;background:rgba(56,189,248,0.12);border-radius:4px;pointer-events:none;z-index:999997;";

overlay.appendChild(hoverBox);
overlay.appendChild(tooltip);
overlay.appendChild(selectBox);
overlay.appendChild(marqueeBox);

function init(){
  if(document.body&&!document.getElementById("__devnuby_overlay")){
    document.body.appendChild(overlay);
  }
}
if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",init);
}else{
  init();
}

function updatePositions(){
  if(!active)return;

  // 1. Update all persistent confirmed boxes
  for(var i=0;i<confirmedBoxes.length;i++){
    var item=confirmedBoxes[i];
    var cr=null;
    if(item.el){
      if(document.contains(item.el)){
        cr=item.el.getBoundingClientRect();
      }
    }else if(item.marquee){
      var msx=window.scrollX||window.pageXOffset||0;
      var msy=window.scrollY||window.pageYOffset||0;
      cr={
        left:item.marquee.docX-msx,
        top:item.marquee.docY-msy,
        width:item.marquee.w,
        height:item.marquee.h
      };
    }
    if(cr){
      item.boxEl.style.left=cr.left+"px";
      item.boxEl.style.top=cr.top+"px";
      item.boxEl.style.width=cr.width+"px";
      item.boxEl.style.height=cr.height+"px";
      var isCVis=!(cr.bottom<-20||cr.top>(window.innerHeight||document.documentElement.clientHeight)+20);
      item.boxEl.style.display=isCVis?"block":"none";
    }else{
      item.boxEl.style.display="none";
    }
  }

  // 2. Update active tentative selectBox
  var r=null;
  if(selectedEl){
    if(!document.contains(selectedEl)){
      selectBox.style.display="none";
      return;
    }
    r=selectedEl.getBoundingClientRect();
  }else if(selectedMarquee){
    var sx=window.scrollX||window.pageXOffset||0;
    var sy=window.scrollY||window.pageYOffset||0;
    r={
      left:selectedMarquee.docX-sx,
      top:selectedMarquee.docY-sy,
      width:selectedMarquee.w,
      height:selectedMarquee.h
    };
  }
  if(!r)return;

  selectBox.style.left=r.left+"px";
  selectBox.style.top=r.top+"px";
  selectBox.style.width=r.width+"px";
  selectBox.style.height=r.height+"px";

  var isVis=!(r.bottom<-20||r.top>(window.innerHeight||document.documentElement.clientHeight)+20);
  selectBox.style.display=isVis?"block":"none";

  parent.postMessage({
    __devnubyScrollUpdate:T,
    rect:{x:r.left,y:r.top,width:r.width,height:r.height},
    visible:isVis
  },"*");
}

window.addEventListener("scroll",updatePositions,{capture:true,passive:true});
window.addEventListener("resize",updatePositions,{passive:true});

window.addEventListener("message",function(e){
  if(!e.data)return;
  if(e.data.__devnubyReqEdits!==undefined){
    active=Boolean(e.data.__devnubyReqEdits);
    if(!active){
      hoverBox.style.display="none";
      tooltip.style.display="none";
      selectBox.style.display="none";
      marqueeBox.style.display="none";
      selectedEl=null;
      selectedMarquee=null;
      for(var p=0;p<confirmedBoxes.length;p++){
        if(confirmedBoxes[p].boxEl&&confirmedBoxes[p].boxEl.parentNode){
          confirmedBoxes[p].boxEl.parentNode.removeChild(confirmedBoxes[p].boxEl);
        }
      }
      confirmedBoxes=[];
    }
  }
  if(e.data.__devnubyConfirmChip){
    var chipId=e.data.__devnubyConfirmChip;
    if(selectedEl||selectedMarquee){
      var cBox=document.createElement("div");
      cBox.style.cssText="position:absolute;border:2px solid #0084ff;background:rgba(0,132,255,0.08);border-radius:4px;pointer-events:none;z-index:999996;";
      var badge=document.createElement("div");
      badge.style.cssText="position:absolute;top:-10px;right:-10px;min-width:20px;height:20px;padding:0 5px;background:#0084ff;color:#fff;border-radius:10px;font-size:11px;font-weight:700;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,132,255,0.5);";
      badge.innerText=String(confirmedBoxes.length+1);
      cBox.appendChild(badge);
      overlay.appendChild(cBox);

      confirmedBoxes.push({
        id:chipId,
        el:selectedEl,
        marquee:selectedMarquee,
        boxEl:cBox,
        badgeEl:badge
      });
      selectBox.style.display="none";
      selectedEl=null;
      selectedMarquee=null;
      updatePositions();
    }
  }
  if(e.data.__devnubyRemoveChip){
    var rId=e.data.__devnubyRemoveChip;
    var nextList=[];
    for(var k=0;k<confirmedBoxes.length;k++){
      if(confirmedBoxes[k].id===rId){
        if(confirmedBoxes[k].boxEl&&confirmedBoxes[k].boxEl.parentNode){
          confirmedBoxes[k].boxEl.parentNode.removeChild(confirmedBoxes[k].boxEl);
        }
      }else{
        nextList.push(confirmedBoxes[k]);
      }
    }
    confirmedBoxes=nextList;
    for(var n=0;n<confirmedBoxes.length;n++){
      confirmedBoxes[n].badgeEl.innerText=String(n+1);
    }
    updatePositions();
  }
  if(e.data.__devnubyClear){
    selectBox.style.display="none";
    selectedEl=null;
    selectedMarquee=null;
    for(var m=0;m<confirmedBoxes.length;m++){
      if(confirmedBoxes[m].boxEl&&confirmedBoxes[m].boxEl.parentNode){
        confirmedBoxes[m].boxEl.parentNode.removeChild(confirmedBoxes[m].boxEl);
      }
    }
    confirmedBoxes=[];
  }
});

document.addEventListener("pointermove",function(e){
  if(!active)return;
  if(dragStart){
    dragCurrent={x:e.clientX,y:e.clientY};
    var rx=Math.min(dragStart.x,dragCurrent.x);
    var ry=Math.min(dragStart.y,dragCurrent.y);
    var rw=Math.abs(dragCurrent.x-dragStart.x);
    var rh=Math.abs(dragCurrent.y-dragStart.y);
    marqueeBox.style.left=rx+"px";
    marqueeBox.style.top=ry+"px";
    marqueeBox.style.width=rw+"px";
    marqueeBox.style.height=rh+"px";
    marqueeBox.style.display="block";
    hoverBox.style.display="none";
    tooltip.style.display="none";
    return;
  }
  if(selectedEl||selectedMarquee)return;

  var el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el||el===document.body||el===document.documentElement||el===overlay||overlay.contains(el)){
    hoverBox.style.display="none";
    tooltip.style.display="none";
    hoverEl=null;
    return;
  }
  var target=el.closest("h1,h2,h3,h4,h5,h6,p,li,tr,blockquote,pre,code,a,table,img,button,div")||el;
  hoverEl=target;
  var r=target.getBoundingClientRect();
  var cs=window.getComputedStyle(target);
  var font=cs.fontSize+" \\""+cs.fontFamily.split(",")[0].replace(/['"]/g,"").trim()+"\\"";

  hoverBox.style.left=r.left+"px";
  hoverBox.style.top=r.top+"px";
  hoverBox.style.width=r.width+"px";
  hoverBox.style.height=r.height+"px";
  hoverBox.style.display="block";

  tooltip.innerHTML="<div style='display:flex;justify-content:space-between;gap:12px;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:3px;'><span>"+target.tagName.toLowerCase()+"</span><span style='color:#94a3b8;font-family:monospace;'>"+Math.round(r.width)+"x"+Math.round(r.height)+"</span></div><div style='display:flex;justify-content:space-between;color:#94a3b8;margin-top:3px;'><span>color</span><span style='color:#e2e8f0;font-family:monospace;'>"+parseHex(cs.color)+"</span></div><div style='display:flex;justify-content:space-between;color:#94a3b8;'><span>font</span><span style='color:#e2e8f0;font-family:monospace;'>"+font+"</span></div>";
  var winW=window.innerWidth||document.documentElement.clientWidth;
  var tx=Math.max(6,Math.min(winW-210,r.left));
  var ty=r.top>=78?r.top-74:r.bottom+8;
  tooltip.style.left=tx+"px";
  tooltip.style.top=ty+"px";
  tooltip.style.display="block";
});

document.addEventListener("click",function(e){
  if(!active)return;
  e.preventDefault();
  e.stopPropagation();
},true);

document.addEventListener("pointerdown",function(e){
  if(!active||e.button!==0)return;
  e.preventDefault();
  dragStart={x:e.clientX,y:e.clientY};
  dragCurrent={x:e.clientX,y:e.clientY};
  selectBox.style.display="none";
  selectedEl=null;
  selectedMarquee=null;
});

document.addEventListener("pointerup",function(e){
  if(!active||!dragStart||!dragCurrent){
    dragStart=null;
    dragCurrent=null;
    return;
  }
  var rw=Math.abs(dragCurrent.x-dragStart.x);
  var rh=Math.abs(dragCurrent.y-dragStart.y);
  marqueeBox.style.display="none";

  if(rw>=10&&rh>=10){
    var rx=Math.min(dragStart.x,dragCurrent.x);
    var ry=Math.min(dragStart.y,dragCurrent.y);
    var sx=window.scrollX||window.pageXOffset||0;
    var sy=window.scrollY||window.pageYOffset||0;
    selectedMarquee={docX:rx+sx,docY:ry+sy,w:rw,h:rh};
    selectedEl=null;

    selectBox.style.left=rx+"px";
    selectBox.style.top=ry+"px";
    selectBox.style.width=rw+"px";
    selectBox.style.height=rh+"px";
    selectBox.style.display="block";

    var s=window.getSelection();
    var txt=s&&!s.isCollapsed?s.toString().trim():"";

    // Collect elements intersecting the marquee box
    var rectR=rx+rw, rectB=ry+rh;
    var candidates=document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,a,button,li,tr,td,th,img,svg,canvas,video,section,header,footer,nav,article,aside,pre,code,div");
    var matched=[];
    var collectedTexts=[];
    for(var i=0;i<candidates.length;i++){
      var el=candidates[i];
      if(el===overlay||overlay.contains(el)||el===document.body||el===document.documentElement)continue;
      var b=el.getBoundingClientRect();
      if(b.width===0||b.height===0)continue;
      if(b.left<rectR&&b.right>rx&&b.top<rectB&&b.bottom>ry){
        matched.push(el);
        var t=(el.innerText||el.textContent||"").trim();
        if(t&&collectedTexts.indexOf(t)===-1){
          collectedTexts.push(t);
        }
      }
    }

    var cx=rx+rw/2;
    var cy=ry+rh/2;
    var scored=[];
    for(var m=0;m<matched.length;m++){
      var mEl=matched[m];
      var mb=mEl.getBoundingClientRect();
      var ix=Math.max(0,Math.min(rectR,mb.right)-Math.max(rx,mb.left));
      var iy=Math.max(0,Math.min(rectB,mb.bottom)-Math.max(ry,mb.top));
      var iArea=ix*iy;
      if(iArea<=0)continue;

      var elArea=Math.max(1,mb.width*mb.height);
      var mArea=Math.max(1,rw*rh);
      var elRatio=iArea/elArea;
      var mRatio=iArea/mArea;

      // Check if mEl contains other matched elements (ancestors get lower priority)
      var containsOther=false;
      for(var k=0;k<matched.length;k++){
        if(k!==m&&mEl.contains(matched[k])){
          containsOther=true;
          break;
        }
      }

      var sc=(elRatio*3.0)+(mRatio*1.5);
      if(!containsOther)sc+=6.0;
      if(mEl.id)sc+=5.0;
      if(/^(IMG|SVG|CANVAS|VIDEO|PICTURE)$/i.test(mEl.tagName))sc+=6.0;
      if(/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/i.test(mEl.tagName))sc+=3.0;
      if(/^(H[1-6]|P|CODE|PRE|LI|SPAN)$/i.test(mEl.tagName))sc+=2.0;

      var elCx=mb.left+mb.width/2;
      var elCy=mb.top+mb.height/2;
      var dist=Math.hypot(elCx-cx,elCy-cy);
      var maxDist=Math.hypot(rw,rh)||1;
      sc-=Math.min(dist/maxDist,2.0);

      scored.push({el:mEl,score:sc,area:elArea});
    }

    scored.sort(function(a,b){
      if(Math.abs(b.score-a.score)>0.5)return b.score-a.score;
      return a.area-b.area;
    });

    var primaryEl=scored.length>0?scored[0].el:null;
    if(!primaryEl){
      var centerEls=document.elementsFromPoint(cx,cy);
      for(var c=0;c<centerEls.length;c++){
        var cel=centerEls[c];
        if(cel&&cel!==overlay&&!overlay.contains(cel)&&cel!==document.body&&cel!==document.documentElement){
          primaryEl=cel;
          break;
        }
      }
    }

    if(!txt){
      txt=collectedTexts.join(" ").trim();
      if(!txt&&primaryEl){
        txt=(primaryEl.innerText||primaryEl.textContent||"").trim();
      }
    }

    var firstText=collectedTexts.length>0?collectedTexts[0]:(primaryEl?(primaryEl.innerText||"").trim():"");
    var lastText=collectedTexts.length>1?collectedTexts[collectedTexts.length-1]:firstText;
    var htmlSnippet=primaryEl?primaryEl.outerHTML.slice(0,250):"";
    var elId=primaryEl?(primaryEl.id||(primaryEl.closest("[id]")?primaryEl.closest("[id]").id:"")): "";
    var elClass=primaryEl&&typeof primaryEl.className==="string"?primaryEl.className:"";
    var elTag=primaryEl?primaryEl.tagName.toLowerCase():"area";
    var elSrc="";
    if(primaryEl){
      if(primaryEl.tagName==="IMG"){
        elSrc=primaryEl.getAttribute("src")||primaryEl.src||"";
      }else{
        var innerImg=primaryEl.querySelector("img");
        if(innerImg)elSrc=innerImg.getAttribute("src")||innerImg.src||"";
      }
    }

    parent.postMessage({
      __devnubyEditSelect:T,
      text:txt||"selected area",
      firstText:firstText,
      lastText:lastText,
      htmlSnippet:htmlSnippet,
      id:elId,
      src:elSrc,
      className:elClass,
      tagName:elTag,
      rect:{x:rx,y:ry,width:rw,height:rh}
    },"*");
  }else if(hoverEl){
    var r=hoverEl.getBoundingClientRect();
    selectedEl=hoverEl;
    selectedMarquee=null;
    selectBox.style.left=r.left+"px";
    selectBox.style.top=r.top+"px";
    selectBox.style.width=r.width+"px";
    selectBox.style.height=r.height+"px";
    selectBox.style.display="block";
    hoverBox.style.display="none";
    tooltip.style.display="none";
    var text=(hoverEl.innerText||hoverEl.textContent||"").trim();
    var hId=hoverEl.id||(hoverEl.closest("[id]")?hoverEl.closest("[id]").id:"");
    var hSrc=hoverEl.tagName==="IMG"?(hoverEl.getAttribute("src")||hoverEl.src||""):(hoverEl.querySelector("img")?(hoverEl.querySelector("img").getAttribute("src")||""):"");
    parent.postMessage({
      __devnubyEditSelect:T,
      text:text,
      firstText:text,
      lastText:text,
      htmlSnippet:hoverEl.outerHTML.slice(0,250),
      tagName:hoverEl.tagName.toLowerCase(),
      id:hId,
      src:hSrc,
      className:typeof hoverEl.className==="string"?hoverEl.className:"",
      rect:{x:r.left,y:r.top,width:r.width,height:r.height}
    },"*");
  }
  dragStart=null;
  dragCurrent=null;
});
})();</script>`;

  if (/<\/body>/i.test(rawHtml)) {
    return rawHtml.replace(/<\/body>/i, `${script}</body>`);
  }
  return `${rawHtml}\n${script}`;
}
