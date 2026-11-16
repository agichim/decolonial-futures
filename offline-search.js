
function makeSearcher(data){
  var ready=false;
  function norm(s){return s.replace(/[\u00C0-\u024F]/g,function(c){return c.normalize("NFD").charAt(0);}).toLowerCase();}
  function prep(){if(ready)return;for(var i=0;i<data.length;i++){data[i].nt=norm(data[i].t);data[i].nx=norm(data[i].x);}ready=true;}
  function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  function terms(q){return norm(q).split(/\s+/).filter(function(t){return t;});}
  function snippet(d,ts){
    var pos=-1,i;
    for(i=0;i<ts.length;i++){var p=d.nx.indexOf(ts[i]);if(p>=0&&(pos<0||p<pos))pos=p;}
    var start=pos<0?0:Math.max(0,pos-70),end=Math.min(d.x.length,start+220);
    var seg=d.nx.slice(start,end),ranges=[];
    ts.forEach(function(t){var p=seg.indexOf(t);while(p>=0){ranges.push([p,p+t.length]);p=seg.indexOf(t,p+t.length);}});
    ranges.sort(function(a,b){return a[0]-b[0];});
    var out="",cur=0;
    ranges.forEach(function(r){if(r[0]<cur)return;out+=esc(d.x.slice(start+cur,start+r[0]))+"<mark>"+esc(d.x.slice(start+r[0],start+r[1]))+"</mark>";cur=r[1];});
    out+=esc(d.x.slice(start+cur,end));
    return (start>0?"\u2026":"")+out+(end<d.x.length?"\u2026":"");
  }
  function search(q){
    var ts=terms(q);
    if(!ts.length||norm(q).replace(/\s/g,"").length<2)return {total:0,items:[]};
    prep();
    var res=[];
    data.forEach(function(d){
      var score=0,ok=true;
      for(var i=0;i<ts.length;i++){
        var t=ts[i],inT=d.nt.indexOf(t)>=0,c=0,p=d.nx.indexOf(t);
        while(p>=0&&c<20){c++;p=d.nx.indexOf(t,p+t.length);}
        if(!inT&&c===0){ok=false;break;}
        score+=(inT?30:0)+c;
      }
      if(ok)res.push({d:d,s:score});
    });
    res.sort(function(a,b){return b.s-a.s;});
    return {total:res.length,items:res.slice(0,50).map(function(r){return {u:r.d.u,t:r.d.t,html:snippet(r.d,ts)};})};
  }
  return {search:search};
}

function gsOrigUrl(pathname,root){
  var parts=pathname.split("/").filter(function(p){return p;}).map(function(p){try{return decodeURIComponent(p);}catch(e){return p;}});
  if(parts.length&&/\.html?$/.test(parts[parts.length-1]))parts.pop();
  var n=root?root.split("../").length-1:0;
  var segs=n>0?parts.slice(Math.max(0,parts.length-n)):[];
  return "https://decolonialfutures.net/"+segs.map(encodeURIComponent).join("/")+(segs.length?"/":"");
}

function gsInit(script){
  var root=(script&&script.getAttribute("data-root"))||"";
  var doClean=!(script&&script.getAttribute("data-clean")==="0");
  var S=makeSearcher(window.GS_INDEX||[]);

  function dropEmpty(p){
    while(p&&p!==document.body&&p!==document.documentElement&&!p.textContent.trim()&&!p.querySelector("img,video,iframe,audio,svg")){
      var up=p.parentNode;if(!up)break;up.removeChild(p);p=up;}
  }
  function clean(){
    var sel="nav,button,form,.wp-block-search,.wp-block-jetpack-subscriptions,.wp-block-navigation,[class*='subscri'],input[type=submit],input[type=email]";
    Array.prototype.forEach.call(document.querySelectorAll(sel),function(e){
      if(e===document.body||e===document.documentElement||!document.body.contains(e))return;
      var p=e.parentNode;p.removeChild(e);dropEmpty(p);
    });
    Array.prototype.forEach.call(document.body.querySelectorAll("a,span,div,p,li,h1,h2,h3,h4,h5,h6,label"),function(e){
      if(!document.body.contains(e)||e.id==="gs-bar"||e.id==="gs-foot")return;
      var t=e.textContent.trim();
      if(t==="Search"||/^subscribe$/i.test(t)||(t.length<=45&&/\bat wordpress\.com\b/i.test(t))){
        var p=e.parentNode;p.removeChild(e);dropEmpty(p);
      }
    });
    var b=document.body,n=b.firstChild;
    while(n){var nx=n.nextSibling;
      if(n.nodeType===3&&/^[\s'"\/>]*$/.test(n.nodeValue)&&/['"\/>]/.test(n.nodeValue))b.removeChild(n);
      n=nx;}
  }
  if(doClean){clean();window.addEventListener("load",clean);setTimeout(clean,1500);}

  var css=document.createElement("style");
  css.textContent="#gs-bar{position:sticky;top:0;z-index:99999;background:#fff;border-bottom:1px solid #ccc;padding:.5rem 0;display:flex;gap:.8rem;align-items:center;font:15px Georgia,serif}"+
   "#gs-bar a{white-space:nowrap}#gs-q{flex:1;padding:.4rem .6rem;font:inherit;border:1px solid #999;border-radius:4px}"+
   "#gs-res{position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #999;box-shadow:0 4px 12px rgba(0,0,0,.2);max-height:70vh;overflow:auto;display:none}"+
   "#gs-res .gs-i{padding:.5rem .7rem;border-bottom:1px solid #eee}#gs-res .gs-t{font-weight:bold}#gs-res .gs-s{font-size:.85em;color:#444;margin-top:.15rem}"+
   "#gs-res .gs-n{padding:.4rem .7rem;font-size:.85em;color:#666}#gs-res mark{background:#ffe680}"+
   "#gs-foot{margin:3rem 0 1rem;padding-top:1rem;border-top:1px solid #ccc;font:13px/1.5 Georgia,serif;color:#555}#gs-foot a{color:#1a4f8a}"+
   ".gs-media-note{margin:.5rem 0 1rem;padding:.4rem .7rem;border-left:3px solid #999;background:#f6f6f6;font:14px/1.5 Georgia,serif;color:#333}";
  document.head.appendChild(css);

  var bar=document.createElement("div");bar.id="gs-bar";
  var home=document.createElement("a");home.href=root+"offline-index.html";home.textContent="\u2190 Index";
  var input=document.createElement("input");input.id="gs-q";input.type="text";input.setAttribute("autocomplete","off");
  input.placeholder="Search titles and content of all pages\u2026";
  var out=document.createElement("div");out.id="gs-res";
  bar.appendChild(home);bar.appendChild(input);bar.appendChild(out);
  document.body.insertBefore(bar,document.body.firstChild);

  var orig=gsOrigUrl(location.pathname,root);
  var ft=document.createElement("div");ft.id="gs-foot";
  ft.innerHTML='Offline copy of <a href="https://decolonialfutures.net/" target="_blank" rel="noopener">decolonialfutures.net</a> (Gesturing Towards Decolonial Futures, GTDF). '+
    'The content comes from the GTDF collective and its contributors. Original page: <a href="'+orig+'" target="_blank" rel="noopener">'+orig+'</a>. '+
    'The site states that its resources are open access under Creative Commons but does not specify which licence here; check the original or ask the authors before reusing. '+
    'This copy is unofficial.';
  document.body.appendChild(ft);

  var MEDIA=/^https?:\/\/(www\.)?decolonialfutures\.net\/.*\.(mp3|m4a|wav|ogg|oga|flac|aac|mp4|m4v|webm|mov)(\?|#|$)/i;
  function addMediaNotes(){
    Array.prototype.forEach.call(document.querySelectorAll("audio[src],video[src],source[src],a[href]"),function(el){
      var isA=el.tagName==="A",u=el.getAttribute(isA?"href":"src");
      if(!u||!MEDIA.test(u)||bar.contains(el)||ft.contains(el)||el.closest(".gs-media-note"))return;
      var seen=Array.prototype.some.call(document.querySelectorAll(".gs-media-note"),function(n){return n.getAttribute("data-src")===u;});
      if(seen)return;
      var host=isA?(el.closest("p,li")||el):(el.closest("figure,.mejs-container")||(el.tagName==="SOURCE"?el.parentNode:el));
      if(!host||!host.parentNode)return;
      var note=document.createElement("div");note.className="gs-media-note";note.setAttribute("data-src",u);
      note.innerHTML='This media can be played on the original website: <a href="'+orig+'" target="_blank" rel="noopener">open the original post</a>.';
      host.parentNode.insertBefore(note,host.nextSibling);
    });
  }
  addMediaNotes();window.addEventListener("load",addMediaNotes);setTimeout(addMediaNotes,1500);

  function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
  var first=null,timer=null;
  function run(){
    var q=input.value;
    if(q.trim().length<2){out.style.display="none";first=null;return;}
    var r=S.search(q);
    first=r.items.length?root+r.items[0].u:null;
    var h='<div class="gs-n">'+r.total+' result'+(r.total===1?'':'s')+(r.total>50?' (showing 50)':'')+'</div>';
    r.items.forEach(function(it){
      h+='<div class="gs-i"><a class="gs-t" href="'+root+encodeURI(it.u)+'">'+esc(it.t)+'</a><div class="gs-s">'+it.html+'</div></div>';
    });
    out.innerHTML=h;out.style.display="block";
  }
  input.addEventListener("input",function(){clearTimeout(timer);timer=setTimeout(run,150);});
  input.addEventListener("focus",function(){if(input.value.trim().length>=2)run();});
  input.addEventListener("keydown",function(e){
    if(e.key==="Enter"&&first){window.location.href=first;}
    if(e.key==="Escape"){out.style.display="none";input.blur();}
  });
  document.addEventListener("click",function(e){if(!bar.contains(e.target))out.style.display="none";});
}

if(typeof module!=="undefined"&&module.exports){module.exports=makeSearcher;module.exports.origUrl=gsOrigUrl;}
if(typeof document!=="undefined"){gsInit(document.currentScript);}
