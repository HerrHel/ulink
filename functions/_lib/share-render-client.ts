/**
 * 分享页渐进增强脚本（从 share-render.ts 拆出；无 JS 时页面完整可用）。
 *
 * 以字符串形式内联进 <script>（分享页 CSP：script-src 'self' 'unsafe-inline'，
 * script-src-attr 'none' —— 只能 addEventListener，禁止内联事件属性）。
 * 写成可读的多行 ES5（老浏览器也能跑），不要引入模板插值 / 箭头函数。
 *
 * 1) 主题切换按钮：写 data-theme + localStorage('lv_theme')
 * 2) favicon 降级：img[data-fb] 加载失败加 .*-img-err → CSS 隐藏、:has() 露出首字母
 * 3) taskItem 未完成项可点击勾选（纯前端视觉，不持久化）：点击切换 data-checked
 * 4) TOC scrollspy：滚动时给当前可见标题对应的导航项加 .active
 * 5) 组分享书签搜索：按 data-search 过滤，无结果显示空态
 * 6) 「复制全部链接」：复制当前可见书签的「标题 + URL」，按钮短暂显示已复制
 * 7) 分类分享布局切换（网格 / 列表 / 小宫格），移动端未指定 layout 时默认列表
 * 8) 分类分享 #focus-* 聚焦：隐藏卡片网格与分类头
 */
export const FALLBACK_JS = `(function(){
var tb=document.getElementById('themeToggle');
if(tb){tb.addEventListener('click',function(){
  var cur=document.documentElement.getAttribute('data-theme');
  if(!cur){cur=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}
  var next=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  document.documentElement.style.colorScheme=next;
  try{localStorage.setItem('lv_theme',next)}catch(e){}
})}

var a=document.querySelectorAll('img[data-fb]');
function err(e){e.classList.add('img-err','bm-img-err','hero-img-err','bmcard-img-err','bmc-img-err','card-logo-img-err','gic-ic-img-err')}
for(var i=0;i<a.length;i++){(function(im){
  im.addEventListener('error',function(){err(im)});
  if(im.complete&&im.naturalWidth===0){err(im)}
})(a[i])}

var t=document.querySelectorAll('li[data-type="taskItem"]');
for(var j=0;j<t.length;j++){(function(li){
  li.style.cursor='pointer';
  li.addEventListener('click',function(){li.setAttribute('data-checked',li.getAttribute('data-checked')==='true'?'false':'true')});
})(t[j])}

var l=document.querySelectorAll('.toc-item');
if(l.length){
  var s=[];
  for(var k=0;k<l.length;k++){var el=document.getElementById(l[k].getAttribute('href').slice(1));if(el)s.push(el)}
  if(s.length){
    var onScroll=function(){
      var idx=0;
      for(var m=0;m<s.length;m++){if(s[m].getBoundingClientRect().top>=0){idx=m;break}}
      if(window.scrollY>=document.documentElement.scrollHeight-window.innerHeight-4){idx=s.length-1}
      for(var q=0;q<l.length;q++){l[q].classList.toggle('active',q===idx)}
    };
    window.addEventListener('scroll',onScroll,{passive:true});
    window.addEventListener('resize',onScroll,{passive:true});
    onScroll();
  }
}

var si=document.getElementById('bmSearchInput');
if(si){si.addEventListener('input',function(){
  var q=si.value.trim().toLowerCase();
  var bms=document.querySelectorAll('#bmList .bm');
  var f=0;
  for(var n=0;n<bms.length;n++){
    var sc=bms[n].getAttribute('data-search')||'';
    var m=!q||sc.indexOf(q)!==-1;
    bms[n].style.display=m?'':'none';
    if(m)f++;
  }
  var em=document.getElementById('bmEmptySearch');
  if(em){em.style.display=(f===0&&q)?'block':'none'}
})}

var cb=document.getElementById('bmCopyAll');
if(cb){
  cb.hidden=false;
  var label=cb.textContent;
  var timer=0;
  var flash=function(text){
    cb.textContent=text;cb.classList.add('done');
    clearTimeout(timer);
    timer=setTimeout(function(){cb.textContent=label;cb.classList.remove('done')},1800);
  };
  var legacyCopy=function(text){
    var ta=document.createElement('textarea');
    ta.value=text;ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    var ok=false;try{ok=document.execCommand('copy')}catch(e){}
    document.body.removeChild(ta);
    return ok;
  };
  cb.addEventListener('click',function(){
    var items=document.querySelectorAll('#bmList .bm');
    var lines=[];
    for(var n=0;n<items.length;n++){
      var it=items[n];
      if(it.style.display==='none')continue;
      var href=it.getAttribute('href')||'';
      if(!href||href==='#')continue;
      var te=it.querySelector('.bm-title');
      var title=te?te.textContent.trim():'';
      lines.push(title?title+'\\n'+href:href);
    }
    if(!lines.length)return;
    var text=lines.join('\\n\\n');
    var doneText=(cb.getAttribute('data-done')||'').replace('{n}',String(lines.length));
    var failText=cb.getAttribute('data-fail')||'';
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){flash(doneText)},function(){flash(legacyCopy(text)?doneText:failText)});
    }else{
      flash(legacyCopy(text)?doneText:failText);
    }
  });
}

var lb=document.querySelectorAll('.cat-layout-btn');
if(lb.length){
  if(!new URLSearchParams(window.location.search).has('layout')){
    var isM=window.matchMedia&&window.matchMedia('(max-width: 768px)').matches;
    if(isM){for(var u=0;u<lb.length;u++){
      if(lb[u].getAttribute('data-layout')==='list'){lb[u].classList.add('active')}
      else if(lb[u].getAttribute('data-layout')==='grid'){lb[u].classList.remove('active')}
    }}
  }
  for(var p=0;p<lb.length;p++){(function(b){b.addEventListener('click',function(e){
    e.preventDefault();
    document.documentElement.classList.remove('share-mobile-list');
    var ly=b.getAttribute('data-layout')||'grid';
    var hf=b.getAttribute('href');
    for(var u=0;u<lb.length;u++){lb[u].classList.remove('active')}
    b.classList.add('active');
    var cg=document.querySelector('.cat-grid');
    if(cg){cg.classList.remove('list-view','mini-grid-view');if(ly!=='grid'){cg.classList.add(ly+'-view')}}
    if(window.history&&window.history.replaceState&&hf){window.history.replaceState(null,'',hf)}
  })})(lb[p])}
}

function syncFocusHash(){
  var h=window.location.hash||'';
  var isF=h.indexOf('#focus-')===0;
  var cg=document.getElementById('cardGrid');
  var ch=document.querySelector('.cat-hero');
  if(cg){cg.style.display=isF?'none':''}
  if(ch){ch.style.display=isF?'none':''}
}
window.addEventListener('hashchange',syncFocusHash);
syncFocusHash();
})()`
