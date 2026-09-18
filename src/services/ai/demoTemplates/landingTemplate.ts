/**
 * 演示模板：产品落地页。
 * Hero + 特性卡 + 定价三档 + FAQ 手风琴 + CTA 弹窗表单；滚动显隐动画；
 * 表单提交记录与主题偏好持久化在 localStorage。无外部依赖，可离线运行。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const LANDING_TEMPLATE: DemoTemplate = {
  id: 'landing',
  name: '产品落地页',
  description: 'Hero、特性矩阵、定价、FAQ 与预约表单的产品宣传页',
  keywords: {
    strong: ['落地页', 'landing', '官网', '主页', '产品介绍页'],
    weak: ['宣传', '营销', '发布页', '品牌页'],
  },
  analystScript: {
    appTitle: '产品落地页',
    appType: 'landing',
    summary: '含 Hero、特性矩阵、定价、FAQ 与预约表单的转化型落地页',
    features: [
      { id: 'F1', name: '首屏 Hero', description: '主标题、副文案与双 CTA 按钮', priority: 'must' },
      { id: 'F2', name: '特性矩阵', description: '六张特性卡片滚动显隐', priority: 'must' },
      { id: 'F3', name: '定价三档', description: '免费、专业、企业三档对比与推荐标记', priority: 'must' },
      { id: 'F4', name: 'FAQ 手风琴', description: '常见问题点击展开收起', priority: 'must' },
      { id: 'F5', name: '预约表单', description: '弹窗表单校验提交，记录留痕', priority: 'must' },
      { id: 'F6', name: '滚动显隐', description: '区块进入视口时淡入上浮', priority: 'nice' },
    ],
    interactions: [
      '点击导航锚点平滑定位到对应区块',
      '点击 CTA 或定价按钮打开预约弹窗，套餐自动带入',
      '表单校验称呼与邮箱格式，失败给出行内提示',
      '提交成功切换成功视图，记录写入 localStorage',
      'FAQ 点击展开收起',
      '滚动时特性与定价卡片淡入显隐',
    ],
    assumptions: ['提交记录仅保存在当前浏览器'],
  },
  defaults: { title: 'Nimbus 云笔记', accent: '#0e7490', dark: false },
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --accent:{{ACCENT}};
  --bg:#f7f8fa;--card:#ffffff;--text:#1f2937;--muted:#6b7280;--border:#e5e7eb;
  --hero:#eef4f7;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 10px 28px rgba(15,23,42,.07);
}
body[data-theme="dark"]{
  --bg:#0b1220;--card:#141d2c;--text:#e5eaf3;--muted:#8b96a8;--border:#26324a;
  --hero:#101a2c;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.35);
}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.7;-webkit-text-size-adjust:100%}
a{color:inherit;text-decoration:none}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;outline:none;width:100%}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
.primary-btn{background:var(--accent);color:#fff;border-radius:12px;padding:11px 22px;font-weight:600;display:inline-block}
.primary-btn:hover{filter:brightness(1.1)}
.ghost-btn{border:1px solid var(--border);border-radius:12px;padding:10px 20px;color:var(--muted);background:var(--card)}
.ghost-btn:hover{color:var(--accent);border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:16px;box-shadow:var(--shadow)}
.container{max-width:1080px;margin:0 auto;padding:0 20px}
.topnav{position:sticky;top:0;z-index:20;background:var(--card);border-bottom:1px solid var(--border)}
.topnav .container{display:flex;align-items:center;gap:20px;height:60px}
.brand{font-weight:700;font-size:17px;display:flex;align-items:center;gap:9px}
.brand .dot{width:12px;height:12px;border-radius:4px;background:var(--accent)}
.nav-links{display:flex;gap:18px;margin-left:auto;color:var(--muted);font-size:14px}
.nav-links a:hover{color:var(--accent)}
.nav-cta{margin-left:6px}
.hero{background:var(--hero);padding:84px 0 76px;text-align:center}
.hero h1{font-size:40px;line-height:1.25;max-width:640px;margin:0 auto 14px}
.hero h1 em{font-style:normal;color:var(--accent)}
.hero p{color:var(--muted);max-width:520px;margin:0 auto 28px}
.hero .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.section{padding:64px 0}
.section-head{text-align:center;margin-bottom:36px}
.section-head h2{font-size:28px;margin-bottom:8px}
.section-head p{color:var(--muted)}
.feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.feature{padding:22px}
.feature .glyph{width:40px;height:40px;border-radius:12px;background:var(--accent);color:#fff;font-size:19px;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.feature h3{font-size:16px;margin-bottom:6px}
.feature p{color:var(--muted);font-size:14px}
.pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;align-items:stretch}
.plan{padding:26px 24px;display:flex;flex-direction:column;position:relative}
.plan h3{font-size:16px;color:var(--muted)}
.plan .price{font-size:34px;font-weight:700;margin:10px 0 4px}
.plan .price small{font-size:14px;color:var(--muted);font-weight:400}
.plan ul{list-style:none;margin:16px 0 24px;display:flex;flex-direction:column;gap:9px;font-size:14px;color:var(--muted)}
.plan ul li::before{content:"✓";color:var(--accent);margin-right:8px;font-weight:700}
.plan .primary-btn,.plan .ghost-btn{text-align:center;margin-top:auto}
.plan.recommended{border-color:var(--accent)}
.plan .badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;font-size:12px;padding:3px 12px;border-radius:999px}
.faq-list{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.faq-q{width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;padding:16px 20px;font-weight:600}
.faq-mark{color:var(--accent);font-size:20px;flex:none}
.faq-a{padding:0 20px 16px;color:var(--muted)}
.cta-band{background:var(--hero);border-radius:20px;padding:44px 32px;text-align:center}
.cta-band h2{font-size:26px;margin-bottom:8px}
.cta-band p{color:var(--muted);margin-bottom:22px}
footer{border-top:1px solid var(--border);padding:24px 0 40px;color:var(--muted);font-size:13px;text-align:center;margin-top:40px}
.modal{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:20px}
.modal[hidden]{display:none}
.modal-mask{position:absolute;inset:0;background:rgba(10,15,25,.55)}
.modal-card{position:relative;width:min(440px,100%);padding:26px;max-height:88vh;overflow:auto}
.modal-close{position:absolute;top:12px;right:14px;color:var(--muted);font-size:16px;padding:6px}
.modal-close:hover{color:var(--text)}
.modal-card h2{font-size:20px;margin-bottom:4px}
.modal-card .lead{color:var(--muted);font-size:14px;margin-bottom:18px}
.modal-card label{display:block;font-size:13px;color:var(--muted);margin:12px 0 6px}
.error{color:#dc2626;font-size:13px;margin:10px 0}
.block{width:100%;margin-top:14px}
.success-view{text-align:center;padding:12px 0}
.success-mark{width:52px;height:52px;border-radius:50%;background:var(--accent);color:#fff;font-size:26px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .5s ease,transform .5s ease}
.reveal.in{opacity:1;transform:none}
@media (max-width:640px){
  .nav-links{display:none}
  .hero h1{font-size:30px}
}
</style>
</head>
<body data-theme="{{THEME}}">
<nav class="topnav">
  <div class="container">
    <div class="brand"><span class="dot"></span>{{TITLE}}</div>
    <div class="nav-links">
      <a href="#features">产品特性</a>
      <a href="#pricing">价格</a>
      <a href="#faq">常见问题</a>
    </div>
    <button class="ghost-btn" id="theme-btn">主题</button>
    <button class="primary-btn nav-cta" data-open-modal>预约演示</button>
  </div>
</nav>

<header class="hero">
  <div class="container">
    <h1>让每一句话，都成为<em>可检索的知识</em></h1>
    <p>{{TITLE}}把零散的笔记、网页与文档聚合成一个会自己生长的第二大脑，团队与个人都能五分钟上手。</p>
    <div class="actions">
      <button class="primary-btn" data-open-modal>免费开始</button>
      <a class="ghost-btn" href="#pricing">查看价格</a>
    </div>
  </div>
</header>

<section class="section" id="features">
  <div class="container">
    <div class="section-head reveal">
      <h2>为持续思考而设计</h2>
      <p>从收集到回顾，每一步都有顺手的工具</p>
    </div>
    <div class="feature-grid">
      <div class="feature card reveal"><div class="glyph">✎</div><h3>全端捕获</h3><p>剪藏网页、转发聊天记录、手机速记，任何来源一键入库。</p></div>
      <div class="feature card reveal"><div class="glyph">◇</div><h3>自动关联</h3><p>相似主题自动建立双向链接，知识网络随笔记增长而生长。</p></div>
      <div class="feature card reveal"><div class="glyph">◐</div><h3>智能回顾</h3><p>按遗忘曲线安排复习提醒，重要知识不再看过就忘。</p></div>
      <div class="feature card reveal"><div class="glyph">▤</div><h3>结构化视图</h3><p>列表、看板与时间线自由切换，任务与资料放在同一处。</p></div>
      <div class="feature card reveal"><div class="glyph">⇄</div><h3>实时协作</h3><p>多人同页编辑，评论与修改记录精确到每一个字符。</p></div>
      <div class="feature card reveal"><div class="glyph">◌</div><h3>隐私优先</h3><p>端到端加密存储，密钥只在你手中，导出格式永不锁定。</p></div>
    </div>
  </div>
</section>

<section class="section" id="pricing">
  <div class="container">
    <div class="section-head reveal">
      <h2>简单透明的定价</h2>
      <p>随时升级或降级，按需付费</p>
    </div>
    <div class="pricing-grid">
      <div class="plan card reveal">
        <h3>免费版</h3>
        <div class="price">¥0<small> / 月</small></div>
        <ul>
          <li>最多 1000 条笔记</li>
          <li>基础双向链接</li>
          <li>单设备离线访问</li>
        </ul>
        <button class="ghost-btn" data-open-modal data-plan="免费版">开始使用</button>
      </div>
      <div class="plan card recommended reveal">
        <span class="badge">推荐</span>
        <h3>专业版</h3>
        <div class="price">¥39<small> / 月</small></div>
        <ul>
          <li>无限笔记与附件</li>
          <li>智能回顾与关联推荐</li>
          <li>多端实时同步</li>
          <li>版本历史保留一年</li>
        </ul>
        <button class="primary-btn" data-open-modal data-plan="专业版">预约演示</button>
      </div>
      <div class="plan card reveal">
        <h3>企业版</h3>
        <div class="price">¥99<small> / 席位 / 月</small></div>
        <ul>
          <li>团队空间与权限体系</li>
          <li>私有化部署选项</li>
          <li>专属客户成功经理</li>
        </ul>
        <button class="ghost-btn" data-open-modal data-plan="企业版">联系销售</button>
      </div>
    </div>
  </div>
</section>

<section class="section" id="faq">
  <div class="container">
    <div class="section-head reveal">
      <h2>常见问题</h2>
      <p>关于 {{TITLE}}，你可能想了解</p>
    </div>
    <div class="faq-list">
      <div class="faq-item card reveal">
        <button class="faq-q">数据保存在哪里，安全吗？<span class="faq-mark">+</span></button>
        <div class="faq-a" hidden><p>默认端到端加密后存储，密钥由你掌握；企业版可选私有化部署，数据完全不出内网。</p></div>
      </div>
      <div class="faq-item card reveal">
        <button class="faq-q">可以导出我的全部笔记吗？<span class="faq-mark">+</span></button>
        <div class="faq-a" hidden><p>支持一键导出为 Markdown 与 PDF 格式，无任何限制，你的数据永远属于你。</p></div>
      </div>
      <div class="faq-item card reveal">
        <button class="faq-q">免费版和专业版的核心差别是什么？<span class="faq-mark">+</span></button>
        <div class="faq-a" hidden><p>主要在容量与智能功能：专业版提供无限容量、智能回顾与多端实时同步。</p></div>
      </div>
      <div class="faq-item card reveal">
        <button class="faq-q">支持团队协作吗？<span class="faq-mark">+</span></button>
        <div class="faq-a" hidden><p>支持。企业版提供团队空间、角色权限与多人实时编辑，评论可精确到段落。</p></div>
      </div>
      <div class="faq-item card reveal">
        <button class="faq-q">如何付费与开票？<span class="faq-mark">+</span></button>
        <div class="faq-a" hidden><p>个人版支持支付宝与微信支付；企业版支持对公转账并开具增值税发票。</p></div>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-band reveal">
      <h2>准备好升级你的第二大脑了吗？</h2>
      <p id="submission-count">已有 0 位用户预约了产品演示</p>
      <button class="primary-btn" data-open-modal>立即预约演示</button>
    </div>
  </div>
</section>

<footer>
  <div class="container">© 2026 {{TITLE}}。演示页面，数据仅保存在本地浏览器。</div>
</footer>

<div id="modal" class="modal" hidden>
  <div class="modal-mask" data-close></div>
  <div class="modal-card card">
    <button class="modal-close" data-close title="关闭">✕</button>
    <div id="form-view">
      <h2>预约产品演示</h2>
      <p class="lead">留下联系方式，我们会在一个工作日内与你约定时间。</p>
      <label for="f-name">称呼</label>
      <input id="f-name" type="text" placeholder="怎么称呼您" maxlength="30">
      <label for="f-email">邮箱</label>
      <input id="f-email" type="text" placeholder="name@example.com" maxlength="60">
      <label for="f-plan">意向套餐</label>
      <select id="f-plan">
        <option>免费版</option>
        <option selected>专业版</option>
        <option>企业版</option>
      </select>
      <label for="f-note">备注（选填）</label>
      <textarea id="f-note" rows="3" placeholder="想了解的功能或问题" maxlength="200"></textarea>
      <p id="form-error" class="error" hidden>请填写称呼，并输入包含 @ 的有效邮箱</p>
      <button id="f-submit" class="primary-btn block">提交预约</button>
    </div>
    <div id="success-view" class="success-view" hidden>
      <div class="success-mark">✓</div>
      <h2>提交成功</h2>
      <p class="lead">我们已收到你的预约，会尽快通过邮箱与你联系。</p>
      <button class="ghost-btn block" data-close>好的</button>
    </div>
  </div>
</div>

<script>
(function(){
  'use strict';
  var STORE_KEY='atoms.demo.landing.v1';
  var THEME_KEY='atoms.demo.landing.theme';
  function loadSubmissions(){
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(!raw)return [];
      var data=JSON.parse(raw);
      return Array.isArray(data)?data:[];
    }catch(e){return [];}
  }
  function saveSubmission(entry){
    try{
      var list=loadSubmissions();
      list.push(entry);
      localStorage.setItem(STORE_KEY,JSON.stringify(list.slice(-50)));
    }catch(e){/* 存储不可用时静默降级 */}
  }
  function refreshCount(){
    var el=document.getElementById('submission-count');
    if(el)el.textContent='已有 '+loadSubmissions().length+' 位用户预约了产品演示';
  }
  var modal=document.getElementById('modal');
  function showFormView(){
    var f=document.getElementById('form-view');
    var s=document.getElementById('success-view');
    var err=document.getElementById('form-error');
    if(f)f.hidden=false;
    if(s)s.hidden=true;
    if(err)err.hidden=true;
  }
  function openModal(plan){
    if(!modal)return;
    showFormView();
    modal.hidden=false;
    document.body.style.overflow='hidden';
    var select=document.getElementById('f-plan');
    if(select&&plan)select.value=plan;
    var name=document.getElementById('f-name');
    if(name)name.focus();
  }
  function closeModal(){
    if(!modal)return;
    modal.hidden=true;
    document.body.style.overflow='';
  }
  function bind(){
    var openers=document.querySelectorAll('[data-open-modal]');
    for(var i=0;i<openers.length;i++){
      openers[i].addEventListener('click',function(){
        openModal(this.getAttribute('data-plan')||'');
      });
    }
    var closers=document.querySelectorAll('[data-close]');
    for(var j=0;j<closers.length;j++){
      closers[j].addEventListener('click',closeModal);
    }
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape')closeModal();
    });
    var submit=document.getElementById('f-submit');
    if(submit)submit.addEventListener('click',function(){
      var nameInput=document.getElementById('f-name');
      var emailInput=document.getElementById('f-email');
      var planSelect=document.getElementById('f-plan');
      var noteInput=document.getElementById('f-note');
      var name=nameInput?nameInput.value.trim():'';
      var email=emailInput?emailInput.value.trim():'';
      if(!name||email.indexOf('@')<1){
        var err=document.getElementById('form-error');
        if(err)err.hidden=false;
        return;
      }
      saveSubmission({
        name:name.slice(0,30),
        email:email.slice(0,60),
        plan:planSelect?planSelect.value:'',
        note:noteInput?noteInput.value.trim().slice(0,200):'',
        at:new Date().toISOString()
      });
      var f=document.getElementById('form-view');
      var s=document.getElementById('success-view');
      if(f)f.hidden=true;
      if(s)s.hidden=false;
      refreshCount();
    });
    var faqButtons=document.querySelectorAll('.faq-q');
    for(var k=0;k<faqButtons.length;k++){
      faqButtons[k].addEventListener('click',function(){
        var item=this.parentNode;
        var answer=item.querySelector('.faq-a');
        var mark=this.querySelector('.faq-mark');
        if(!answer)return;
        var willOpen=answer.hidden;
        answer.hidden=!willOpen;
        if(mark)mark.textContent=willOpen?'−':'+';
      });
    }
    var reveals=document.querySelectorAll('.reveal');
    if('IntersectionObserver' in window){
      var io=new IntersectionObserver(function(entries){
        for(var i=0;i<entries.length;i++){
          if(entries[i].isIntersecting){
            entries[i].target.classList.add('in');
            io.unobserve(entries[i].target);
          }
        }
      },{threshold:0.12});
      for(var m=0;m<reveals.length;m++){io.observe(reveals[m]);}
    }else{
      for(var n=0;n<reveals.length;n++){reveals[n].classList.add('in');}
    }
    var themeBtn=document.getElementById('theme-btn');
    if(themeBtn)themeBtn.addEventListener('click',function(){
      var next=document.body.getAttribute('data-theme')==='dark'?'light':'dark';
      document.body.setAttribute('data-theme',next);
      try{localStorage.setItem(THEME_KEY,next);}catch(e){}
    });
  }
  (function initTheme(){
    var saved='';
    try{saved=localStorage.getItem(THEME_KEY)||'';}catch(e){}
    if(saved==='dark'||saved==='light')document.body.setAttribute('data-theme',saved);
  })();
  bind();
  refreshCount();
})();
</script>
</body>
</html>`,
};
