/**
 * 演示模板：数据仪表盘。
 * 侧边栏视图切换 + 4 张 KPI 卡 + Chart.js 折线、柱状图 + 可排序数据表；
 * 时间范围筛选联动全部视图；数据快照与筛选状态持久化在 localStorage。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const DASHBOARD_TEMPLATE: DemoTemplate = {
  id: 'dashboard',
  name: '数据仪表盘',
  description: 'KPI 概览、趋势与渠道图表、可排序数据表的经营数据看板',
  keywords: {
    strong: ['仪表盘', 'dashboard', '监控', '后台管理'],
    weak: ['数据', '统计', '概览', '报表', '工作台'],
  },
  analystScript: {
    appTitle: '数据仪表盘',
    appType: 'dashboard',
    summary: '含 KPI 概览、趋势与渠道图表、可排序数据表的经营看板',
    features: [
      { id: 'F1', name: 'KPI 概览', description: '销售额、订单数、客单价、转化率与环比', priority: 'must' },
      { id: 'F2', name: '趋势折线图', description: '按天展示所选周期的销售额走势', priority: 'must' },
      { id: 'F3', name: '渠道柱状图', description: '对比各获客渠道的销售额构成', priority: 'must' },
      { id: 'F4', name: '可排序数据表', description: '按日期、订单数、销售额、客单价排序', priority: 'must' },
      { id: 'F5', name: '时间范围筛选', description: '近 7、30、90 天切换，联动图表与表格', priority: 'must' },
      { id: 'F6', name: '快照持久化', description: '数据快照与筛选状态保存在 localStorage', priority: 'nice' },
    ],
    interactions: [
      '切换时间范围，KPI、图表与表格联动刷新',
      '点击表头切换升序、降序排序',
      '点击重新生成快照，得到一份新的模拟数据',
      '侧边栏在经营总览与数据明细之间切换',
      '切换深浅色主题，图表配色跟随变化',
    ],
    assumptions: ['演示数据由本地随机算法生成，不代表真实业务'],
  },
  defaults: { title: '经营数据仪表盘', accent: '#1d4ed8', dark: false },
  html: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{TITLE}}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --accent:{{ACCENT}};
  --bg:#f4f5f7;--card:#ffffff;--text:#1f2937;--muted:#6b7280;--border:#e5e7eb;
  --up:#059669;--down:#dc2626;
  --chart-grid:rgba(31,41,55,.08);--chart-text:#6b7280;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 10px 28px rgba(15,23,42,.07);
}
body[data-theme="dark"]{
  --bg:#0b1220;--card:#141d2c;--text:#e5eaf3;--muted:#8b96a8;--border:#26324a;
  --up:#34d399;--down:#f87171;
  --chart-grid:rgba(229,234,243,.1);--chart-text:#8b96a8;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.35);
}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-text-size-adjust:100%}
.layout{display:flex;min-height:100vh}
.sidebar{width:208px;flex:none;background:var(--card);border-right:1px solid var(--border);padding:20px 14px;display:flex;flex-direction:column;gap:22px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px}
.brand .dot{width:12px;height:12px;border-radius:4px;background:var(--accent);flex:none}
.nav{display:flex;flex-direction:column;gap:4px}
.nav-item{text-align:left;padding:9px 12px;border-radius:10px;color:var(--muted);position:relative}
.nav-item:hover{background:var(--bg);color:var(--text)}
.nav-item.active{background:var(--accent);color:#fff;font-weight:600}
.sidebar-foot{margin-top:auto;border-top:1px solid var(--border);padding-top:14px}
.main{flex:1 1 auto;min-width:0;padding:22px 26px 48px}
.topbar{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;margin-bottom:18px}
.topbar h1{font-size:22px}
.controls{display:flex;gap:10px;align-items:center}
select,button{font:inherit;color:inherit}
select{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:8px 12px;outline:none}
select:focus{border-color:var(--accent)}
button{cursor:pointer;border:none;background:none}
.ghost-btn{border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:var(--muted);background:var(--card)}
.ghost-btn:hover{color:var(--accent);border-color:var(--accent)}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow)}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:16px}
.kpi{padding:16px 18px}
.kpi-label{color:var(--muted);font-size:13px}
.kpi-value{font-size:26px;font-weight:700;margin:4px 0 2px;font-variant-numeric:tabular-nums}
.kpi-delta{font-size:13px;color:var(--muted)}
.kpi-delta .up{color:var(--up)}
.kpi-delta .down{color:var(--down)}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.chart-card{padding:16px 18px}
.chart-card h2{font-size:15px;margin-bottom:10px;color:var(--muted);font-weight:600}
.chart-wrap{position:relative;height:280px}
.chart-fallback{padding:24px;text-align:center;color:var(--muted)}
.table-card{padding:6px 6px 10px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px 16px;border-bottom:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums}
th{color:var(--muted);font-weight:600;user-select:none}
th.sortable{cursor:pointer}
th.sortable:hover{color:var(--accent)}
th.sort-asc::after{content:" ↑";color:var(--accent)}
th.sort-desc::after{content:" ↓";color:var(--accent)}
tbody tr:hover{background:var(--bg)}
tfoot td{color:var(--muted);font-weight:600}
@media (max-width:820px){
  .layout{flex-direction:column}
  .sidebar{width:100%;flex-direction:row;align-items:center;gap:14px;padding:12px 16px;border-right:none;border-bottom:1px solid var(--border)}
  .nav{flex-direction:row}
  .sidebar-foot{margin-top:0;margin-left:auto;border-top:none;padding-top:0}
  .main{padding:16px 14px 40px}
}
</style>
</head>
<body data-theme="{{THEME}}">
<div class="layout">
  <aside class="sidebar">
    <div class="brand"><span class="dot"></span>{{TITLE}}</div>
    <nav class="nav">
      <button class="nav-item active" data-view="overview">经营总览</button>
      <button class="nav-item" data-view="table">数据明细</button>
    </nav>
    <div class="sidebar-foot">
      <button id="theme-btn" class="ghost-btn">切换深浅色</button>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <h1 id="view-title">经营总览</h1>
      <div class="controls">
        <select id="range-select" title="时间范围">
          <option value="7">近 7 天</option>
          <option value="30" selected>近 30 天</option>
          <option value="90">近 90 天</option>
        </select>
        <button id="regen-btn" class="ghost-btn">重新生成快照</button>
      </div>
    </header>
    <section id="view-overview">
      <div class="kpi-grid">
        <div class="kpi card"><div class="kpi-label">总销售额（元）</div><div class="kpi-value" id="kpi-sales">0</div><div class="kpi-delta" id="kpi-sales-delta"></div></div>
        <div class="kpi card"><div class="kpi-label">订单数</div><div class="kpi-value" id="kpi-orders">0</div><div class="kpi-delta" id="kpi-orders-delta"></div></div>
        <div class="kpi card"><div class="kpi-label">客单价（元）</div><div class="kpi-value" id="kpi-aov">0</div><div class="kpi-delta" id="kpi-aov-delta"></div></div>
        <div class="kpi card"><div class="kpi-label">转化率</div><div class="kpi-value" id="kpi-conv">0%</div><div class="kpi-delta" id="kpi-conv-delta"></div></div>
      </div>
      <div class="chart-grid">
        <div class="chart-card card">
          <h2>销售趋势</h2>
          <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
          <div id="trend-fallback" class="chart-fallback" hidden>图表库未能加载，请检查网络后刷新页面</div>
        </div>
        <div class="chart-card card">
          <h2>渠道构成</h2>
          <div class="chart-wrap"><canvas id="channel-chart"></canvas></div>
          <div id="channel-fallback" class="chart-fallback" hidden>图表库未能加载，请检查网络后刷新页面</div>
        </div>
      </div>
    </section>
    <section id="view-table" hidden>
      <div class="table-card card">
        <table>
          <thead>
            <tr>
              <th class="sortable" data-key="date">日期</th>
              <th class="sortable" data-key="orders">订单数</th>
              <th class="sortable" data-key="sales">销售额（元）</th>
              <th class="sortable" data-key="aov">客单价（元）</th>
            </tr>
          </thead>
          <tbody id="table-body"></tbody>
        </table>
      </div>
    </section>
  </main>
</div>
<script>
(function(){
  'use strict';
  var STORE_KEY='atoms.demo.dashboard.v1';
  var CHANNELS=['直访','自然搜索','付费推广','社交来源','口碑推荐'];
  var state={range:30,theme:'light',sortKey:'date',sortDir:'desc',seed:0,days:[]};

  function mulberry32(a){
    return function(){
      a|=0;a=a+0x6D2B79F5|0;
      var t=Math.imul(a^a>>>15,1|a);
      t=t+Math.imul(t^t>>>7,61|t)^t;
      return((t^t>>>14)>>>0)/4294967296;
    };
  }
  function pad2(n){return n<10?'0'+n:''+n;}
  function fmtDate(d){return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
  function makeSnapshot(){
    var seed=Date.now()%1000000007;
    var rand=mulberry32(seed);
    var days=[];
    var base=1+rand()*0.5;
    var today=new Date();
    for(var i=179;i>=0;i--){
      var d=new Date(today.getTime()-i*86400000);
      var dow=d.getDay();
      var weekend=(dow===0||dow===6)?0.72:1;
      var growth=1+(179-i)*0.0022;
      var noise=0.82+rand()*0.36;
      var sales=Math.round(42000*base*growth*weekend*noise);
      var aov=Math.round(160+rand()*90);
      var orders=Math.max(20,Math.round(sales/aov));
      days.push({date:fmtDate(d),sales:sales,orders:orders});
    }
    return {seed:seed,days:days};
  }
  function load(){
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(raw){
        var data=JSON.parse(raw);
        if(data&&typeof data==='object'){
          state.range=data.range===7||data.range===90?data.range:30;
          state.theme=data.theme==='dark'?'dark':'light';
          state.sortKey=data.sortKey==='date'||data.sortKey==='orders'||data.sortKey==='sales'||data.sortKey==='aov'?data.sortKey:'date';
          state.sortDir=data.sortDir==='asc'?'asc':'desc';
          state.seed=typeof data.seed==='number'?data.seed:0;
          state.days=Array.isArray(data.days)&&data.days.length===180?data.days:[];
        }
      }
    }catch(e){
      /* 快照损坏时走重新生成 */
    }
    if(state.days.length!==180){
      var snap=makeSnapshot();
      state.seed=snap.seed;
      state.days=snap.days;
      persist();
    }
  }
  function persist(){
    try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(e){/* 存储不可用时降级为内存态 */}
  }
  function currentRows(){return state.days.slice(-state.range);}
  function prevRows(){return state.days.slice(-state.range*2,-state.range);}
  function sumBy(rows,key){
    var total=0;
    for(var i=0;i<rows.length;i++){total+=rows[i][key];}
    return total;
  }
  function pctDelta(cur,prev){
    if(!prev)return 0;
    return (cur-prev)/prev*100;
  }
  function fmtPct(v){return (v>=0?'+':'')+v.toFixed(1)+'%';}
  function fmtMoney(v){return Math.round(v).toLocaleString('zh-CN');}
  function convRate(rows){
    var h=0;
    for(var i=0;i<rows.length;i++){h=(h*31+rows[i].sales)%997;}
    return 1.8+h/997*2.4;
  }
  function setDelta(id,rate){
    var el=document.getElementById(id);
    if(!el)return;
    el.textContent='较上一周期 '+fmtPct(rate);
    el.innerHTML='较上一周期 <span class="'+(rate>=0?'up':'down')+'">'+fmtPct(rate)+'</span>';
  }
  function renderKpis(){
    var cur=currentRows();
    var prev=prevRows();
    var sales=sumBy(cur,'sales');
    var orders=sumBy(cur,'orders');
    var aov=orders>0?sales/orders:0;
    var conv=convRate(cur);
    var pSales=sumBy(prev,'sales');
    var pOrders=sumBy(prev,'orders');
    var pAov=sumBy(prev,'orders')>0?pSales/pOrders:0;
    var pConv=convRate(prev);
    var el;
    el=document.getElementById('kpi-sales');if(el)el.textContent=fmtMoney(sales);
    setDelta('kpi-sales-delta',pctDelta(sales,pSales));
    el=document.getElementById('kpi-orders');if(el)el.textContent=orders.toLocaleString('zh-CN');
    setDelta('kpi-orders-delta',pctDelta(orders,pOrders));
    el=document.getElementById('kpi-aov');if(el)el.textContent=fmtMoney(aov);
    setDelta('kpi-aov-delta',pctDelta(aov,pAov));
    el=document.getElementById('kpi-conv');if(el)el.textContent=conv.toFixed(1)+'%';
    setDelta('kpi-conv-delta',pctDelta(conv,pConv));
  }
  var trendChart=null;
  var channelChart=null;
  function cssVar(name){
    var v=getComputedStyle(document.body).getPropertyValue(name).trim();
    return v||'#6b7280';
  }
  function channelWeights(){
    var w=[0.30,0.24,0.18,0.15,0.13];
    var rand=mulberry32(state.seed+7);
    for(var k=0;k<4;k++){
      var i=Math.floor(rand()*w.length);
      var j=Math.floor(rand()*w.length);
      var t=w[i];w[i]=w[j];w[j]=t;
    }
    return w;
  }
  function renderCharts(){
    var rows=currentRows();
    var fallbackTrend=document.getElementById('trend-fallback');
    var fallbackChannel=document.getElementById('channel-fallback');
    if(typeof Chart==='undefined'){
      if(fallbackTrend)fallbackTrend.hidden=false;
      if(fallbackChannel)fallbackChannel.hidden=false;
      return;
    }
    if(fallbackTrend)fallbackTrend.hidden=true;
    if(fallbackChannel)fallbackChannel.hidden=true;
    var accent=cssVar('--accent');
    var grid=cssVar('--chart-grid');
    var tick={color:cssVar('--chart-text')};
    var labels=rows.map(function(r){return r.date.slice(5);});
    var sales=rows.map(function(r){return r.sales;});
    if(trendChart){trendChart.destroy();trendChart=null;}
    trendChart=new Chart(document.getElementById('trend-chart'),{
      type:'line',
      data:{labels:labels,datasets:[{
        label:'销售额',
        data:sales,
        borderColor:accent,
        backgroundColor:accent+'22',
        fill:true,
        tension:0.35,
        pointRadius:0,
        borderWidth:2
      }]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{
          x:{grid:{display:false},ticks:tick},
          y:{grid:{color:grid},ticks:tick}
        }}
    });
    var total=sumBy(rows,'sales');
    var weights=channelWeights();
    var values=CHANNELS.map(function(name,i){return Math.round(total*weights[i]);});
    var shades=[accent,accent+'D0',accent+'A0',accent+'70',accent+'45'];
    if(channelChart){channelChart.destroy();channelChart=null;}
    channelChart=new Chart(document.getElementById('channel-chart'),{
      type:'bar',
      data:{labels:CHANNELS,datasets:[{
        label:'销售额',
        data:values,
        backgroundColor:shades,
        borderRadius:8,
        borderSkipped:false
      }]},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{
          x:{grid:{display:false},ticks:tick},
          y:{grid:{color:grid},ticks:tick}
        }}
    });
  }
  function renderTable(){
    var body=document.getElementById('table-body');
    if(!body)return;
    var rows=currentRows().map(function(r){
      return {date:r.date,orders:r.orders,sales:r.sales,aov:r.orders>0?Math.round(r.sales/r.orders):0};
    });
    var dir=state.sortDir==='asc'?1:-1;
    rows.sort(function(a,b){
      if(a[state.sortKey]<b[state.sortKey])return -1*dir;
      if(a[state.sortKey]>b[state.sortKey])return 1*dir;
      return 0;
    });
    body.innerHTML=rows.map(function(r){
      return '<tr><td>'+r.date+'</td><td>'+r.orders.toLocaleString('zh-CN')+'</td><td>'+fmtMoney(r.sales)+'</td><td>'+fmtMoney(r.aov)+'</td></tr>';
    }).join('');
    var ths=document.querySelectorAll('th.sortable');
    for(var i=0;i<ths.length;i++){
      var th=ths[i];
      th.classList.remove('sort-asc','sort-desc');
      if(th.getAttribute('data-key')===state.sortKey){
        th.classList.add(state.sortDir==='asc'?'sort-asc':'sort-desc');
      }
    }
  }
  function renderAll(){
    renderKpis();
    renderCharts();
    renderTable();
  }
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function bindEvents(){
    var rangeSelect=document.getElementById('range-select');
    if(rangeSelect){
      rangeSelect.value=String(state.range);
      rangeSelect.addEventListener('change',function(){
        state.range=Number(rangeSelect.value)===7||Number(rangeSelect.value)===90?Number(rangeSelect.value):30;
        persist();
        renderAll();
      });
    }
    var regenBtn=document.getElementById('regen-btn');
    if(regenBtn)regenBtn.addEventListener('click',function(){
      var snap=makeSnapshot();
      state.seed=snap.seed;
      state.days=snap.days;
      persist();
      renderAll();
    });
    var navItems=document.querySelectorAll('.nav-item');
    for(var i=0;i<navItems.length;i++){
      navItems[i].addEventListener('click',function(){
        var view=this.getAttribute('data-view');
        for(var j=0;j<navItems.length;j++){navItems[j].classList.toggle('active',navItems[j]===this);}
        var overview=document.getElementById('view-overview');
        var table=document.getElementById('view-table');
        var title=document.getElementById('view-title');
        if(view==='table'){
          if(overview)overview.hidden=true;
          if(table)table.hidden=false;
          if(title)title.textContent='数据明细';
        }else{
          if(overview)overview.hidden=false;
          if(table)table.hidden=true;
          if(title)title.textContent='经营总览';
        }
      });
    }
    var ths=document.querySelectorAll('th.sortable');
    for(var k=0;k<ths.length;k++){
      ths[k].addEventListener('click',function(){
        var key=this.getAttribute('data-key');
        if(!key)return;
        if(state.sortKey===key){
          state.sortDir=state.sortDir==='asc'?'desc':'asc';
        }else{
          state.sortKey=key;
          state.sortDir='desc';
        }
        persist();
        renderTable();
      });
    }
    var themeBtn=document.getElementById('theme-btn');
    if(themeBtn)themeBtn.addEventListener('click',function(){
      state.theme=state.theme==='dark'?'light':'dark';
      applyTheme();
      persist();
      renderCharts();
    });
  }
  load();
  applyTheme();
  bindEvents();
  renderAll();
})();
</script>
</body>
</html>`,
};
