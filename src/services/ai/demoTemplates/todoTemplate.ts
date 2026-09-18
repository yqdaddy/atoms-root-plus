/**
 * 演示模板：待办清单。
 * 完整可交互单文件 HTML：增删改查、勾选完成、优先级与分类标签、
 * 视图与分类筛选、清空已完成、深浅色切换，localStorage 完整持久化。
 * 约束：内容不含反引号、${、反斜杠与 em-dash，保证可安全内嵌 TS 模板字符串。
 */
import type { DemoTemplate } from './types';

export const TODO_TEMPLATE: DemoTemplate = {
  id: 'todo',
  name: '待办清单',
  description: '支持增删改查、优先级、分类筛选与本地持久化的任务管理应用',
  keywords: {
    strong: ['待办', 'todo', '任务', '任务清单', '清单'],
    weak: ['计划', '日程', '事项', '打卡'],
  },
  analystScript: {
    appTitle: '待办清单',
    appType: 'todo',
    summary: '支持增删改查、优先级标签、分类与视图筛选的本地待办应用',
    features: [
      { id: 'F1', name: '任务增删', description: '输入框回车或按钮添加，逐条删除', priority: 'must' },
      { id: 'F2', name: '勾选完成', description: '点击圆圈切换完成态并划线标识', priority: 'must' },
      { id: 'F3', name: '行内编辑', description: '点击编辑改为输入框，回车或失焦保存', priority: 'must' },
      { id: 'F4', name: '优先级与分类', description: '高、中、低优先级与工作、生活、学习分类标签', priority: 'must' },
      { id: 'F5', name: '视图筛选', description: '全部、进行中、已完成与分类双维度过滤', priority: 'must' },
      { id: 'F6', name: '清空与持久化', description: '一键清空已完成，数据保存在 localStorage', priority: 'nice' },
    ],
    interactions: [
      '输入任务名，选择优先级与分类后添加',
      '点击圆圈切换完成状态，划线展示',
      '点击编辑进入行内编辑，回车或失焦保存',
      '切换全部、进行中、已完成与分类筛选',
      '点击清空已完成批量移除',
      '刷新页面后任务与筛选状态完整恢复',
    ],
    assumptions: ['演示数据仅保存在当前浏览器'],
  },
  defaults: { title: '待办清单', accent: '#0d9488', dark: false },
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
  --bg:#f4f5f7;--card:#ffffff;--text:#1f2937;--muted:#6b7280;--border:#e5e7eb;
  --danger:#dc2626;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 10px 28px rgba(15,23,42,.07);
}
body[data-theme="dark"]{
  --bg:#0b1220;--card:#141d2c;--text:#e5eaf3;--muted:#8b96a8;--border:#26324a;
  --danger:#f87171;
  --shadow:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.35);
}
body{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-text-size-adjust:100%}
.app{max-width:720px;margin:0 auto;padding:28px 16px 56px}
.topbar{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin-bottom:20px}
.topbar h1{font-size:24px;letter-spacing:.5px}
.topbar .sub{color:var(--muted);font-size:13px;margin-top:2px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow)}
.composer{display:flex;flex-wrap:wrap;gap:10px;padding:14px;margin-bottom:14px}
.composer input[type="text"]{flex:2 1 200px;min-width:0}
.composer select{flex:1 1 110px}
input,select,textarea{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:9px 12px;outline:none}
input:focus,select:focus{border-color:var(--accent)}
button{font:inherit;cursor:pointer;border:none;background:none;color:inherit}
.primary-btn{background:var(--accent);color:#fff;border-radius:10px;padding:9px 18px;font-weight:600}
.primary-btn:hover{filter:brightness(1.08)}
.ghost-btn{border:1px solid var(--border);border-radius:10px;padding:8px 14px;color:var(--muted);background:var(--card)}
.ghost-btn:hover{color:var(--accent);border-color:var(--accent)}
.toolbar{display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between;padding:10px 14px;margin-bottom:14px}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tab{padding:6px 14px;border-radius:999px;color:var(--muted);border:1px solid transparent}
.tab:hover{color:var(--accent)}
.tab.active{background:var(--accent);color:#fff;font-weight:600}
.task-list{list-style:none;display:flex;flex-direction:column;gap:10px;margin-bottom:14px}
.task-list .empty{background:var(--card);border:1px dashed var(--border);border-radius:14px;padding:28px;text-align:center;color:var(--muted)}
.task{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:12px 16px;box-shadow:var(--shadow)}
.check{width:22px;height:22px;flex:none;border:2px solid var(--muted);border-radius:50%;color:#fff;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center}
.task.done .check{background:var(--accent);border-color:var(--accent)}
.task .name{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.task.done .name{color:var(--muted);text-decoration:line-through}
.edit-input{flex:1 1 auto;min-width:0;padding:4px 8px}
.tag{flex:none;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
.prio-high{color:var(--danger);border-color:var(--danger)}
.prio-mid{color:#d97706;border-color:#d97706}
.prio-low{color:#059669;border-color:#059669}
.ops{display:flex;gap:4px;flex:none}
.op{padding:5px 10px;border-radius:8px;color:var(--muted);font-size:13px}
.op:hover{background:var(--bg);color:var(--accent)}
.op.del:hover{color:var(--danger)}
.list-footer{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;color:var(--muted);font-size:14px}
@media (max-width:560px){
  .composer select{flex:1 1 45%}
  .tag.prio{display:none}
}
</style>
</head>
<body data-theme="{{THEME}}">
<div class="app">
  <header class="topbar">
    <div>
      <h1>{{TITLE}}</h1>
      <p class="sub">数据实时保存在浏览器 localStorage，刷新不丢失</p>
    </div>
    <button id="theme-btn" class="ghost-btn">切换深浅色</button>
  </header>
  <section class="composer card">
    <input id="new-task" type="text" placeholder="输入新任务，回车或点击添加" maxlength="120">
    <select id="new-priority">
      <option value="high">高优先级</option>
      <option value="mid" selected>中优先级</option>
      <option value="low">低优先级</option>
    </select>
    <select id="new-category">
      <option value="work" selected>工作</option>
      <option value="life">生活</option>
      <option value="study">学习</option>
    </select>
    <button id="add-btn" class="primary-btn">添加任务</button>
  </section>
  <section class="toolbar card">
    <div class="tabs" id="status-tabs">
      <button class="tab active" data-status="all">全部</button>
      <button class="tab" data-status="active">进行中</button>
      <button class="tab" data-status="done">已完成</button>
    </div>
    <div class="tabs" id="category-tabs">
      <button class="tab active" data-cat="all">所有分类</button>
      <button class="tab" data-cat="work">工作</button>
      <button class="tab" data-cat="life">生活</button>
      <button class="tab" data-cat="study">学习</button>
    </div>
  </section>
  <ul id="task-list" class="task-list"></ul>
  <footer class="list-footer card">
    <span id="stat-line">共 0 项，已完成 0 项</span>
    <button id="clear-done" class="ghost-btn">清空已完成</button>
  </footer>
</div>
<script>
(function(){
  'use strict';
  var STORE_KEY='atoms.demo.todo.v1';
  var PRIORITIES={high:'高',mid:'中',low:'低'};
  var CATEGORIES={work:'工作',life:'生活',study:'学习'};
  var state={tasks:[],status:'all',category:'all',theme:'light'};

  function sanitizeTask(raw){
    if(!raw||typeof raw!=='object')return null;
    if(typeof raw.id!=='string'||raw.id.length===0)return null;
    if(typeof raw.name!=='string'||raw.name.length===0)return null;
    return{
      id:raw.id.slice(0,64),
      name:raw.name.slice(0,120),
      done:raw.done===true,
      priority:raw.priority==='high'||raw.priority==='low'?raw.priority:'mid',
      category:CATEGORIES[raw.category]?raw.category:'work'
    };
  }
  function load(){
    try{
      var raw=localStorage.getItem(STORE_KEY);
      if(!raw)return;
      var data=JSON.parse(raw);
      if(!data||typeof data!=='object')return;
      state.tasks=Array.isArray(data.tasks)?data.tasks.map(sanitizeTask).filter(Boolean):[];
      state.status=data.status==='active'||data.status==='done'?data.status:'all';
      state.category=CATEGORIES[data.category]?data.category:'all';
      state.theme=data.theme==='dark'?'dark':'light';
    }catch(e){
      /* 历史数据损坏时按空列表启动，不阻塞使用 */
    }
  }
  function save(){
    try{localStorage.setItem(STORE_KEY,JSON.stringify(state));}catch(e){/* 存储不可用时降级为内存态 */}
  }
  function esc(value){
    return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function uid(){return 't'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
  function visibleTasks(){
    return state.tasks.filter(function(t){
      if(state.status==='active'&&t.done)return false;
      if(state.status==='done'&&!t.done)return false;
      if(state.category!=='all'&&t.category!==state.category)return false;
      return true;
    });
  }
  function render(){
    var list=document.getElementById('task-list');
    if(!list)return;
    var tasks=visibleTasks();
    if(tasks.length===0){
      list.innerHTML='<li class="empty">当前筛选下暂无任务，在上方输入框添加一条试试</li>';
    }else{
      list.innerHTML=tasks.map(function(t){
        return '<li class="task'+(t.done?' done':'')+'" data-id="'+t.id+'">'
          +'<button class="check" title="切换完成状态">'+(t.done?'✓':'')+'</button>'
          +'<span class="name">'+esc(t.name)+'</span>'
          +'<span class="tag prio prio-'+t.priority+'">'+PRIORITIES[t.priority]+'优先</span>'
          +'<span class="tag">'+CATEGORIES[t.category]+'</span>'
          +'<span class="ops"><button class="op edit">编辑</button><button class="op del">删除</button></span>'
          +'</li>';
      }).join('');
    }
    var doneCount=state.tasks.filter(function(t){return t.done;}).length;
    var stat=document.getElementById('stat-line');
    if(stat)stat.textContent='共 '+state.tasks.length+' 项，已完成 '+doneCount+' 项';
    save();
  }
  function addTask(){
    var input=document.getElementById('new-task');
    if(!input)return;
    var name=input.value.trim();
    if(!name){input.focus();return;}
    var priority=document.getElementById('new-priority');
    var category=document.getElementById('new-category');
    var prio='mid';
    if(priority&&(priority.value==='high'||priority.value==='low'))prio=priority.value;
    var cat='work';
    if(category&&CATEGORIES[category.value])cat=category.value;
    state.tasks.unshift({id:uid(),name:name.slice(0,120),done:false,priority:prio,category:cat});
    input.value='';
    input.focus();
    render();
  }
  function startEdit(li,task){
    var nameSpan=li.querySelector('.name');
    if(!nameSpan)return;
    var editor=document.createElement('input');
    editor.className='edit-input';
    editor.value=task.name;
    editor.maxLength=120;
    nameSpan.replaceWith(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length,editor.value.length);
    var commit=function(){
      var next=editor.value.trim();
      if(next)task.name=next.slice(0,120);
      render();
    };
    editor.addEventListener('keydown',function(e){
      if(e.key==='Enter')editor.blur();
      if(e.key==='Escape'){editor.value=task.name;editor.blur();}
    });
    editor.addEventListener('blur',commit);
  }
  function bindTabs(wrapId,field,attr){
    var wrap=document.getElementById(wrapId);
    if(!wrap)return;
    wrap.addEventListener('click',function(e){
      var btn=e.target.closest('.tab');
      if(!btn)return;
      var value=btn.getAttribute(attr);
      if(!value)return;
      state[field]=value;
      var tabs=wrap.querySelectorAll('.tab');
      for(var i=0;i<tabs.length;i++){tabs[i].classList.toggle('active',tabs[i]===btn);}
      render();
    });
  }
  function applyTheme(){document.body.setAttribute('data-theme',state.theme);}
  function bindEvents(){
    var addBtn=document.getElementById('add-btn');
    var input=document.getElementById('new-task');
    if(addBtn)addBtn.addEventListener('click',addTask);
    if(input)input.addEventListener('keydown',function(e){if(e.key==='Enter')addTask();});
    var list=document.getElementById('task-list');
    if(list){
      list.addEventListener('click',function(e){
        var li=e.target.closest('li.task');
        if(!li)return;
        var id=li.getAttribute('data-id');
        var task=null;
        for(var i=0;i<state.tasks.length;i++){
          var item=state.tasks[i];
          if(item&&item.id===id){task=item;break;}
        }
        if(!task)return;
        if(e.target.closest('.check')){task.done=!task.done;render();}
        else if(e.target.closest('.del')){state.tasks=state.tasks.filter(function(t){return t.id!==task.id;});render();}
        else if(e.target.closest('.edit')){startEdit(li,task);}
      });
    }
    bindTabs('status-tabs','status','data-status');
    bindTabs('category-tabs','category','data-cat');
    var clearBtn=document.getElementById('clear-done');
    if(clearBtn)clearBtn.addEventListener('click',function(){
      state.tasks=state.tasks.filter(function(t){return !t.done;});
      render();
    });
    var themeBtn=document.getElementById('theme-btn');
    if(themeBtn)themeBtn.addEventListener('click',function(){
      state.theme=state.theme==='dark'?'light':'dark';
      applyTheme();
      save();
    });
  }
  load();
  applyTheme();
  bindEvents();
  render();
})();
</script>
</body>
</html>`,
};
