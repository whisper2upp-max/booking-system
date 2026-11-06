// EIC project overview. All business writes use the shared workspace.
function overviewRange(fy,today){
  const weeks=getFYWeeks(fy),current=getFridayOfWeek(dayjs(today)).format('YYYY-MM-DD');
  const found=weeks.findIndex(w=>w>=current),index=found<0?weeks.length-1:found;
  const first=Math.min(Math.max(0,index-2),Math.max(0,weeks.length-12));
  return {start:weeks[first],end:weeks[Math.min(first+11,weeks.length-1)]};
}
function overviewTaskMatches(task,project){
  return !!((task.projectId&&task.projectId===project.id)||(task.projectCode&&task.projectCode===project.code));
}
function overviewTaskSourcePrefix(project){
  return (project.id||'project-code:'+encodeURIComponent(project.code))+'::';
}
function overviewProjectTaskDraft(snapshot,project){
  const tasks=(snapshot.tasks||[]).filter(task=>overviewTaskMatches(task,project));
  const keys=new Set(tasks.map(taskSourceKey).filter(Boolean)),prefix=overviewTaskSourcePrefix(project);
  const belongs=key=>keys.has(key)||String(key||'').startsWith(prefix)||overviewTaskMatches(snapshot.sourceMeta?.[key]||{},project);
  return {...snapshot,tasks,coveredSourceKeys:Array.from(new Set([...(snapshot.coveredSourceKeys||[]).filter(belongs),...keys])),deletedSources:(snapshot.deletedSources||[]).filter(item=>belongs(item.sourceKey))};
}
function overviewTaskSnapshotTime(snapshot,project){
  const scoped=overviewProjectTaskDraft(snapshot,project),base=snapshot.fullUpdatedAt||snapshot.updatedAt||snapshot.savedAt||'';
  return [base,...scoped.coveredSourceKeys.map(key=>snapshot.sourceMeta?.[key]?.updatedAt||base)].sort().pop();
}
function mergeOverviewProjectTasks(snapshot,project,edited){
  const keys=new Set([...(edited.coveredSourceKeys||[]),...(edited.tasks||[]).map(taskSourceKey)]),prefix=overviewTaskSourcePrefix(project);
  const belongs=key=>keys.has(key)||String(key||'').startsWith(prefix)||overviewTaskMatches(snapshot.sourceMeta?.[key]||{},project);
  const tasks=[];let inserted=false;
  (snapshot.tasks||[]).forEach(task=>{
    if(overviewTaskMatches(task,project)){if(!inserted){tasks.push(...edited.tasks);inserted=true;}}
    else tasks.push(task);
  });
  if(!inserted)tasks.push(...edited.tasks);
  const sourceMeta={...snapshot.sourceMeta};
  keys.forEach(key=>{if(key)sourceMeta[key]={projectId:project.id||'',projectCode:project.code||'',updatedAt:edited.updatedAt};});
  return {...snapshot,fullUpdatedAt:snapshot.fullUpdatedAt||snapshot.updatedAt||snapshot.savedAt||'',updatedAt:edited.updatedAt,sourceMeta,tasks,
    coveredSourceKeys:Array.from(new Set([...(snapshot.coveredSourceKeys||[]),...(edited.coveredSourceKeys||[])])),
    deletedSources:[...(snapshot.deletedSources||[]).filter(item=>!belongs(item.sourceKey)),...(edited.deletedSources||[])]};
}
function buildProjectOverview(data,filter,today){
  const catalog=new Map(),ensure=(code,name)=>{
    if(!code)return null;
    if(!catalog.has(code))catalog.set(code,{code,name:name||code,project:null,eics:new Set(),allRows:[]});
    return catalog.get(code);
  };
  data.projects.forEach(p=>{const item=ensure(p.code,p.name);if(item){item.project=p;item.name=p.name||p.code;if(p.eic)item.eics.add(p.eic);}});
  data.eicData.forEach(row=>{const p=ensure(row.engagementCode,row.engagementName);if(p){p.allRows.push(row);if(row.eic)p.eics.add(row.eic);}});
  data.budgetData.forEach(b=>ensure(b.engagementCode,b.engagementName));
  const eics=Array.from(new Set(Array.from(catalog.values()).flatMap(p=>Array.from(p.eics)))).sort();
  const query=String(filter.query||'').trim().toLowerCase();
  const items=Array.from(catalog.values()).filter(p=>(!filter.eic||p.eics.has(filter.eic))&&(!query||[p.name,p.code,p.project?.fic,...p.eics].join(' ').toLowerCase().includes(query))).map(p=>{
    const selected=p.allRows.filter(r=>!filter.eic||r.eic===filter.eic);
    const periodRows=selected.filter(r=>r.week>=filter.start&&r.week<=filter.end);
    const byWeek={},people=new Map();
    periodRows.forEach(r=>{byWeek[r.week]=(byWeek[r.week]||0)+Number(r.hrs||0);const key=r.name+'|'+r.eic;if(!people.has(key))people.set(key,{key,name:r.name,eic:r.eic,levels:new Set(),weeks:{},total:0});const person=people.get(key);person.levels.add(r.level);person.weeks[r.week]=(person.weeks[r.week]||0)+Number(r.hrs||0);person.total+=Number(r.hrs||0);});
    const project=p.project||{id:'',code:p.code,name:p.name,nodes:[]};
    const nodes=(project.nodes||[]).filter(n=>n.week>=filter.start&&n.week<=filter.end).sort((a,b)=>(a.date||a.week).localeCompare(b.date||b.week));
    const budgets=data.budgetData.filter(b=>b.engagementCode===p.code);
    const snapshots=data.taskLists.filter(s=>{const scoped=overviewProjectTaskDraft(s,project);return scoped.tasks.length||scoped.coveredSourceKeys.length||scoped.deletedSources.length;}).sort((a,b)=>overviewTaskSnapshotTime(b,project).localeCompare(overviewTaskSnapshotTime(a,project)));
    return {...p,project,eics:Array.from(p.eics),periodRows,byWeek,people:Array.from(people.values()).sort((a,b)=>a.name.localeCompare(b.name)).map(p=>({...p,level:Array.from(p.levels).join(' / ')})),periodHrs:periodRows.reduce((n,r)=>n+Number(r.hrs||0),0),nodes,budgets,booking:workspaceProjectTotals(data.eicData,p.code,data.rates),actual:workspaceProjectTotals(data.timesheetData,p.code,data.rates),actualRows:data.timesheetData.filter(r=>r.engagementCode===p.code),snapshots,overdue:nodes.filter(n=>n.completed!=='Y'&&n.week<today).length};
  }).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  return {items,eics,projectOptions:Array.from(catalog.values()).map(p=>({code:p.code,name:p.name})),people:new Set(items.flatMap(p=>p.people.map(person=>person.name))).size,hours:items.reduce((n,p)=>n+p.periodHrs,0),overdue:items.reduce((n,p)=>n+p.overdue,0)};
}
function OverviewBudgetEditor({item,onClose,onSaved}){
  const w=React.useContext(WorkspaceContext),[rowId,setRowId]=useState(item.budgets[0]?.id||'');
  const initial=id=>w.data.budgetData.find(b=>b.id===id)||{engagementCode:item.code,engagementName:item.name,budgetHrs:0,budgetSER:0,benchmark:'hrs',remark:''};
  const [draft,setDraft]=useState(()=>({...initial(rowId)})),[error,setError]=useState('');
  const save=()=>{
    if(!['budgetHrs','budgetSER'].every(k=>String(draft[k]).trim()!==''&&Number.isFinite(Number(draft[k]))&&Number(draft[k])>=0)){setError('预算须填写大于或等于 0 的数字。');return;}
    try{w.commit('项目总览：保存预算',d=>{const values={...draft,budgetHrs:Number(draft.budgetHrs),budgetSER:Number(draft.budgetSER)};if(rowId){if(!d.budgetData.some(b=>b.id===rowId))throw Error('该预算已不存在，请重新打开。');d.budgetData=d.budgetData.map(b=>b.id===rowId?{...b,...values}:b);}else d.budgetData.push({...values,id:makeTaskListId('budget')});});onSaved();}catch(e){setError(e.message);}
  };
  return <UtilityDialog title="编辑项目预算" detail={item.name+' · '+item.code} onClose={onClose} className="overview-budget-editor">
    {item.budgets.length>1&&<label>同 Code 有多条预算，请选择记录<select aria-label="选择预算记录" value={rowId} onChange={e=>{setRowId(e.target.value);setDraft({...initial(e.target.value)});}}>{item.budgets.map((b,i)=><option key={b.id} value={b.id}>{i+1}. {b.engagementName} · {fmt(b.budgetHrs)}h</option>)}</select></label>}
    <div className="resolution-form"><label>预算工时<input aria-label="预算工时" type="number" min="0" value={draft.budgetHrs} onChange={e=>setDraft({...draft,budgetHrs:e.target.value})}/></label><label>预算 SER<input aria-label="预算 SER" type="number" min="0" value={draft.budgetSER} onChange={e=>setDraft({...draft,budgetSER:e.target.value})}/></label><label>预警基准<select aria-label="预警基准" value={draft.benchmark} onChange={e=>setDraft({...draft,benchmark:e.target.value})}><option value="hrs">工时</option><option value="SER">SER</option></select></label><label>备注<input aria-label="预算备注" value={draft.remark} onChange={e=>setDraft({...draft,remark:e.target.value})}/></label></div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="glass-btn" onClick={onClose}>取消</button><button className="glass-btn primary-btn" onClick={save}>保存预算</button></div>
  </UtilityDialog>;
}
function ProjectOverview({state,setState,onBack,onBackToTimeline}){
  const w=React.useContext(WorkspaceContext),today=dayjs().format('YYYY-MM-DD');
  const fy=state.fy||getCurrentFY(),allWeeks=useMemo(()=>getFYWeeks(fy),[fy]),range=overviewRange(fy,today);
  const start=state.start||range.start,end=state.end||range.end,eic=state.eic||'',unit=state.unit||'hrs';
  const weeks=allWeeks.filter(week=>week>=start&&week<=end),currentWeek=getFridayOfWeek(dayjs(today)).format('YYYY-MM-DD');
  const model=useMemo(()=>buildProjectOverview(w.data,{eic,query:'',start,end},today),[w.data,eic,start,end,today]);
  const p=model.items.find(item=>item.code===state.projectCode)||model.items[0],projectIndex=model.items.indexOf(p);
  const [editing,setEditing]=useState(null),[message,setMessage]=useState(''),[editError,setEditError]=useState('');
  const scrollRef=useRef(null),scrollPosition=useRef({top:state.scrollTop||0,left:state.scrollLeft||0}),firstMount=useRef(true);
  const update=values=>setState(prev=>({...prev,...values}));
  const changeRange=values=>{update(values);if(scrollRef.current){scrollRef.current.scrollTop=0;scrollRef.current.scrollLeft=0;}};
  useEffect(()=>{if(p&&state.projectCode!==p.code)update({projectCode:p.code});},[p?.code]);
  useEffect(()=>{if(scrollRef.current){scrollRef.current.scrollTop=firstMount.current?state.scrollTop||0:0;scrollRef.current.scrollLeft=firstMount.current?state.scrollLeft||0:0;}firstMount.current=false;},[p?.code]);
  useEffect(()=>()=>{setState(prev=>({...prev,scrollTop:scrollPosition.current.top,scrollLeft:scrollPosition.current.left}));},[]);
  const chooseProject=code=>{setMessage('');setEditError('');update({projectCode:code});};
  const done=()=>{setEditing(null);setEditError('');setMessage('已保存，相关页面已同步。');};
  const saveEdit=action=>{try{action();done();}catch(e){}};
  const edit=(kind,item,extra={})=>{setMessage('');setEditError('');setEditing({kind,code:item.code,projectId:item.project.id,...extra});};
  const item=editing&&model.items.find(item=>item.code===editing.code),project=editing&&w.data.projects.find(item=>item.id===editing.projectId),node=project?.nodes.find(n=>n.id===editing?.nodeId);
  const selectedSnapshot=editing&&w.data.taskLists.find(s=>s.id===editing.snapshotId);
  const deleteNode=()=>{if(confirm('删除此节点？可通过全局撤销恢复。'))saveEdit(()=>w.commit('项目总览：删除节点',d=>{d.projects=d.projects.map(item=>item.id===project.id?{...item,nodes:item.nodes.filter(n=>n.id!==node.id)}:item);}));};
  const saveNode=nodeData=>{const date=parseWeekString(nodeData.date);if(!date){setEditError('请填写有效的节点日期。');return;}saveEdit(()=>w.commit('项目总览：保存节点',d=>{d.projects=d.projects.map(item=>{if(item.id!==project.id)return item;const value={...nodeData,week:getFridayOfWeek(date).format('YYYY-MM-DD')};return {...item,nodes:node?item.nodes.map(n=>n.id===node.id?{...n,...value}:n):[...item.nodes,{id:makeTaskListId('node'),...value}]};});}));};
  const fiscalYears=Array.from(new Set([getCurrentFY(),'FY'+(Number(getCurrentFY().slice(2))+1),fy,...w.data.eicData.map(r=>{const date=dayjs(r.week);return 'FY'+String(date.month()>=6?date.year()+1:date.year()).slice(-2);}),...w.data.projects.flatMap(item=>item.nodes.map(n=>{const date=dayjs(n.week);return 'FY'+String(date.month()>=6?date.year()+1:date.year()).slice(-2);}))])).sort();
  const budget=p?.budgets.length===1?p.budgets[0]:null,limit=budget?Number(unit==='SER'?budget.budgetSER:budget.budgetHrs):null;
  const criterion=budget?.benchmark==='SER'?'SER':'hrs',criterionLimit=budget?Number(criterion==='SER'?budget.budgetSER:budget.budgetHrs):0;
  const bookingOver=budget&&p.booking[criterion]>criterionLimit,actualOver=budget&&p.actual[criterion]>criterionLimit;
  const snapshot=p?.snapshots.find(s=>s.id===state.snapshots?.[p.code])||p?.snapshots[0],tasks=(snapshot?.tasks||[]).filter(t=>overviewTaskMatches(t,p.project));
  const color=p?getProjectColor(p.code):'#82976f',projectOptions=model.items.map(item=>({value:item.code,label:item.name,detail:item.code+' · FIC '+(item.project.fic||'待补充'),keywords:item.eics.join(' ')}));
  const weekSizes=weeks.map(week=>Math.max(0,...(p?.nodes||[]).filter(n=>n.week===week).map(n=>
    Array.from(String(n.name||'')).reduce((width,char)=>width+(/[\u0000-\u007f]/.test(char)?8:13),0)+(n.note?.trim()?19:0)+(n.attention?.trim()?19:0)+36)));
  const overviewColumns=weekSizes.map(size=>`minmax(max(var(--overview-week), ${size}px), 1fr)`).join(' ');
  const overviewWidth='calc(var(--overview-info)'+weekSizes.map(size=>` + max(var(--overview-week), ${size}px)`).join('')+')';
  return <div className="sub-app overview-app"><WorkspaceHeader section="EIC 项目总览" onBack={onBack}/>
    <main className="overview-workspace" style={{'--project-color':color,'--project-wash':color+'12','--project-slot':color+'28'}}>
      <header className="overview-toolbar">
        <div className="overview-heading"><h1>项目总览</h1>{window.BOOKING_PREVIEW_DEMO&&<span>演示数据</span>}</div>
        <label className="overview-eic-filter">EIC<select aria-label="总览 EIC" value={eic} onChange={e=>changeRange({eic:e.target.value})}><option value="">全部 EIC</option>{model.eics.map(name=><option key={name}>{name}</option>)}</select></label>
        <div className="overview-project-picker"><span>当前项目</span><PersonPicker key={eic} label="选择总览项目" placeholder="搜索项目名称、Code 或 FIC" value={p?.code||''} onChange={chooseProject} options={projectOptions} itemNoun="项目" itemUnit="个"/></div>
        <nav className="overview-project-switch" aria-label="切换项目"><button aria-label="上一个项目" disabled={projectIndex<=0} onClick={()=>chooseProject(model.items[projectIndex-1].code)}>‹</button><span>{p?projectIndex+1:0} / {model.items.length}</span><button aria-label="下一个项目" disabled={!p||projectIndex>=model.items.length-1} onClick={()=>chooseProject(model.items[projectIndex+1].code)}>›</button></nav>
      </header>
      {!p?<div className="overview-empty"><UIIcon name="folder"/><h2>暂无相关项目</h2><p>{eic?'可切换 EIC；项目归属来自 EIC 排班和项目组 EIC。':'先在 EIC 排班管理导入排班，再维护预算及节点。'}</p><div className="overview-project-actions"><button className="glass-btn overview-back-timeline" onClick={onBackToTimeline}>返回节点管理</button><button className="glass-btn" onClick={()=>w.go('eic','booking')}>进入排班管理</button></div></div>:<article className="overview-project" data-project-code={p.code}>
        <header className="overview-project-heading"><div className="overview-project-identity"><div className="overview-project-title"><h2>{p.name}</h2><div className="overview-code">{p.code}{p.eics.length>1&&<span>跨 EIC</span>}</div></div><div className="overview-metadata"><span>FIC <strong>{p.project.fic||'待补充'}</strong>{p.project.fic&&BookingStaff.isPendingName(p.project.fic)&&<span className="pending-person-badge">Pending</span>}</span><span>EIC <strong>{p.eics.join(' / ')||'未关联'}</strong></span>{p.project.section&&<span>Section <strong>{p.project.section}</strong></span>}{p.project.papers&&<span>底稿规模 <strong>{p.project.papers}</strong></span>}</div></div><div className="overview-project-actions"><button className="glass-btn overview-back-timeline" onClick={onBackToTimeline}>返回节点管理</button>{p.project.id&&<button className="glass-btn" onClick={()=>edit('project',p)}>项目信息</button>}<button className="glass-btn primary-btn" onClick={()=>edit('manual',p)}><UIIcon name="plus"/>手动排班</button></div></header>
        <div className="overview-content">
          <section className="overview-schedule-panel" aria-label="项目排班与节点">
            <header className="overview-panel-heading">
              <div className="overview-panel-title"><h3>交付与排班</h3><span>所选 EIC · 所选期间</span></div>
              <div className="overview-filters"><label>财年<select aria-label="总览财年" value={fy} onChange={e=>changeRange({fy:e.target.value,...overviewRange(e.target.value,today)})}>{fiscalYears.map(f=><option key={f}>{f}</option>)}</select></label><label>开始周<select aria-label="总览开始周" value={start} onChange={e=>changeRange({start:e.target.value,end:e.target.value>end?e.target.value:end})}>{allWeeks.map(week=><option key={week} value={week}>{week.slice(5).replace('-','/')}</option>)}</select></label><span className="overview-range-dash">—</span><label>结束周<select aria-label="总览结束周" value={end} onChange={e=>changeRange({end:e.target.value})}>{allWeeks.filter(week=>week>=start).map(week=><option key={week} value={week}>{week.slice(5).replace('-','/')}</option>)}</select></label><button onClick={()=>changeRange(overviewRange(fy,today))}>本周附近</button><button onClick={()=>changeRange({start:allWeeks[0],end:allWeeks[allWeeks.length-1]})}>全年</button><small>日期按周五归属</small></div>
              <div className="overview-summary" aria-label="当前项目统计"><span className={p.overdue?'attention':''}>{p.overdue?<><b>{p.overdue}</b> 项逾期</>:<><b>{p.nodes.filter(n=>n.completed==='Y').length}/{p.nodes.length}</b> 节点完成</>}</span><span><b>{p.people.length}</b> 人</span><span><b>{fmt(p.periodHrs)}</b>h 排班</span></div>
            </header>
            <div className="overview-scroll" ref={scrollRef} onScroll={e=>{scrollPosition.current={top:e.currentTarget.scrollTop,left:e.currentTarget.scrollLeft};}} style={{'--overview-weeks':weeks.length}}>
              <div className="overview-canvas" style={{'--overview-columns':overviewColumns,width:overviewWidth}}>
                <div className="overview-axis"><div className="overview-axis-label">节点 / 排班<small>{fy} · {weeks.length} 周</small></div><div className="overview-week-grid">{weeks.map(week=><div key={week} className={week===currentWeek?'current':''}><span>{week.slice(0,4)} · {getPhaseLabel(week)==='pre'?'预审':'年审'}</span><strong>{dayjs(week).format('MM/DD')}</strong></div>)}</div></div>
                <div className="overview-node-section"><div className="overview-node-label"><h4>交付节点</h4><p><strong>{p.nodes.filter(n=>n.completed==='Y').length}</strong> / {p.nodes.length} 已完成</p>{p.overdue>0&&<span className="attention">{p.overdue} 项逾期</span>}<small>点节点编辑内容<br/>点状态更新完成情况</small></div><div className="overview-week-grid overview-node-lane">{weeks.map(week=><div key={week} className="overview-node-week">{p.nodes.filter(n=>n.week===week).sort((a,b)=>String(a.date||a.week).localeCompare(String(b.date||b.week))).map(n=><div className={'overview-node '+(n.highlight?'highlight':'')} key={n.id}><button className="overview-node-content" onClick={()=>edit('node',p,{week,nodeId:n.id})} title={n.note||n.name}><time>{dayjs(n.date||n.week).format('MM/DD')}</time><span className="overview-node-title"><span className="overview-node-name">{n.name}</span>{n.attention?.trim()&&<span className="node-progress-info node-attention-info" title={n.attention} aria-label={"节点注意事项："+n.attention}>!</span>}{n.note?.trim()&&<span className="node-progress-info" title={n.note} aria-label={"节点进展："+n.note}>?</span>}</span></button><button className={'overview-node-state '+(n.completed==='Y'?'done':n.completed==='N'||n.week<today?'late':'waiting')} aria-label={'更新状态 '+p.code+' '+n.name} onClick={()=>edit('status',p,{nodeId:n.id})}>{n.completed==='Y'?(n.delayed?'Y 延迟完成':'Y 已完成'):n.completed==='N'||n.week<today?'N 未完成':'待确认'}</button></div>)}{p.project.id&&<button className="overview-node-add" aria-label={'新增节点 '+p.code+' '+week} onClick={()=>edit('node',p,{week})}>＋</button>}</div>)}</div></div>
                <div className="overview-total-row"><div className="overview-person-label"><strong>排班合计</strong><span>{fmt(p.periodHrs)}h</span><small>{p.people.some(person=>BookingStaff.isPendingName(person.name))?'含 Pending 人员':'本项目 · 所选 EIC'}</small></div><div className="overview-week-grid">{weeks.map(week=><div key={week}><button className={'overview-hours '+(p.byWeek[week]?'filled':'empty')} aria-label={p.code+' '+week+' 排班'} onClick={()=>p.byWeek[week]?edit('booking',p,{week}):edit('manual',p,{week})}>{p.byWeek[week]?fmt(p.byWeek[week]):'＋'}</button></div>)}</div></div>
                <div className="overview-people">{p.people.length?p.people.map(person=><div className="overview-person-row" key={person.key}><div className="overview-person-label"><StaffName name={person.name} level={person.level}/><span>{fmt(person.total)}h</span><small>{person.eic}</small></div><div className="overview-week-grid">{weeks.map(week=><button key={week} disabled={!person.weeks[week]} aria-label={'编辑排班 '+p.code+' '+person.name+' '+week} onClick={()=>edit('booking',p,{week,name:person.name,personEic:person.eic})}>{person.weeks[week]?fmt(person.weeks[week]):'—'}</button>)}</div></div>):<div className="overview-inline-empty">所选期间没有该 EIC 的排班；项目预算和节点仍可查看。</div>}</div>
              </div>
            </div>
          </section>
          <aside className="overview-sidebar">
            <section className="overview-finance" aria-label="项目预算与实际"><header><div><h3>预算与实际</h3><small>同 Code · 项目累计</small></div><div className="overview-unit" role="group" aria-label="预算显示单位">{[['hrs','工时'],['SER','SER']].map(([key,label])=><button key={key} aria-pressed={unit===key} onClick={()=>update({unit:key})}>{label}</button>)}</div></header>
              <div className="overview-budget-limit"><span>项目预算</span><strong>{p.budgets.length>1?'重复':limit===null?'—':fmt(limit)}</strong><button onClick={()=>edit('budget',p)}>编辑预算</button></div>
              <dl>{[['booking','累计排班',p.booking[unit],bookingOver],['actual','实际工时',p.actualRows.length?p.actual[unit]:null,actualOver]].map(([key,label,value,over])=><div key={key} className={over?'over':''}><dt>{label}{unit==='SER'&&key==='actual'?' · SER':''}</dt><dd>{key==='actual'?<button onClick={()=>edit('actual',p)} title="查看实际工时人员明细">{value===null?'—':fmt(value)}<UIIcon name="arrow"/></button>:fmt(value)}</dd>{limit>0&&value!==null&&<div className="overview-budget-track" aria-label={label+'预算占用'}><span style={{width:Math.min(100,value/limit*100)+'%'}}/></div>}</div>)}</dl>
              <p className={bookingOver||actualOver?'overview-budget-state over':'overview-budget-state'}>{!p.budgets.length?'未设置预算':p.budgets.length>1?'同 Code 多条预算，请核对':(bookingOver?'排班超 '+fmt(p.booking[criterion]-criterionLimit):actualOver?'实际超 '+fmt(p.actual[criterion]-criterionLimit):'排班剩余 '+fmt(criterionLimit-p.booking[criterion]))+(criterion==='hrs'?'h':' SER')+' · '+(criterion==='hrs'?'工时':'SER')+'基准'}</p>
            </section>
            <section className="overview-tasks" aria-label="项目 Task 分工"><header><div><h3>Task 分工 <span>{tasks.length}</span></h3><small>已保存的项目任务</small></div><button onClick={()=>edit('task-scope',p,{snapshotId:snapshot?.id})} aria-label="选择 Task 编辑范围">生成 / 编辑<UIIcon name="arrow"/></button></header>
              {p.snapshots.length>0&&<select aria-label={'Task 存档 '+p.code} value={snapshot.id} onChange={e=>update({snapshots:{...state.snapshots,[p.code]:e.target.value}})}>{p.snapshots.map(s=><option key={s.id} value={s.id}>{s.periodStart} — {s.periodEnd}</option>)}</select>}
              <div className="overview-task-list">{tasks.length?tasks.map(t=><div className="overview-task-row" key={t.id}><div className="overview-task-dates"><span>{t.nodeName||'自定义任务'}</span><time>{t.dueDate?dayjs(t.dueDate).format('MM/DD'):'待填写'} 截止</time></div><strong>{t.taskDescription||'未填写任务描述'}</strong><p>{t.assignees?.join('、')||'未分工'}</p><small>{t.startDate||'待填写'} → {t.dueDate||'待填写'}{t.splitGroupId?' · 拆分任务':''}</small></div>):<div className="overview-inline-empty">{snapshot?'本存档没有该项目的关联 Task。':'暂无已保存的关联 Task。'}<small>手填项目名称的任务不自动归入。</small></div>}</div><footer>按存档期间展示，不受左侧周范围影响。</footer>
            </section>
          </aside>
        </div>
      </article>}
      {message&&<div className="overview-message" role="status">{message}<button aria-label="关闭保存提示" onClick={()=>setMessage('')}>×</button></div>}
    </main>
    {editing?.kind==='project'&&project&&<ProjectEditModal project={project} onClose={()=>setEditing(null)} onSave={values=>{w.commit('项目总览：编辑项目信息',d=>{d.projects=d.projects.map(p=>p.id===project.id?{...p,...values}:p);});update({projectCode:values.code,snapshots:{...state.snapshots,[values.code]:state.snapshots?.[project.code]}});done();}}/>}
    {editing?.kind==='node'&&project&&<NodeEditorModal project={project} week={editing.week} editNode={node} onSave={saveNode} onDelete={node?deleteNode:undefined} onClose={()=>{setEditing(null);setEditError('');}}/>}
    {editError&&<div className="workspace-error" role="alert">{editError}<button aria-label="关闭日期提示" onClick={()=>setEditError('')}>×</button></div>}
    {editing?.kind==='status'&&project&&node&&<StatusModal project={project} node={node} onClose={()=>setEditing(null)} onDelete={deleteNode} onSave={(completed,note,actualDate)=>saveEdit(()=>w.commit('项目总览：更新节点状态',d=>{d.projects=d.projects.map(p=>p.id===project.id?{...p,nodes:p.nodes.map(n=>n.id===node.id?applyWorkspaceNodeStatus(n,completed,note,actualDate):n)}:p);}))}/>}
    {editing?.kind==='budget'&&item&&<OverviewBudgetEditor item={item} onSaved={done} onClose={()=>setEditing(null)}/>}
    {editing?.kind==='actual'&&item&&<UtilityDialog title="实际工时人员明细" detail={item.name+' · 当前 Timesheet 的项目累计'} onClose={()=>setEditing(null)}><div className="resolution-table-wrap"><table className="resolution-table"><thead><tr><th>人员</th><th>Level</th><th>工时</th><th>SER</th></tr></thead><tbody>{item.actualRows.map((r,i)=><tr key={i}><td>{r.employeeName}</td><td>{r.level}</td><td>{fmt(r.hrs)}</td><td>{fmt(Number(r.hrs)*(Number(w.data.rates[r.level])||0))}</td></tr>)}</tbody></table>{!item.actualRows.length&&<p className="overview-inline-empty">当前 Timesheet 没有该项目的实际工时记录。</p>}</div></UtilityDialog>}
    {editing?.kind==='booking'&&item&&<AnomalyBookingEditor issue={{type:'booking',code:item.code,title:item.name,eic:editing.personEic||eic,week:editing.week,name:editing.name,eicOnly:true}} onClose={()=>setEditing(null)} onSaved={done}/>}
    {editing?.kind==='manual'&&item&&<ManualBookingModal data={w.data.eicData} allProjects={model.projectOptions} weeks={allWeeks.map(fridayDate=>({fridayDate,label:fy+' '+dayjs(fridayDate).format('MM/DD')}))} initialProject={item} initialWeek={editing.week||start} onClose={()=>setEditing(null)} onAdd={entries=>{const keys=new Set(entries.map(e=>`${e.name}|${e.engagementCode}|${e.week}`));w.replaceEic([...w.data.eicData.filter(e=>!keys.has(`${e.name}|${e.engagementCode}|${e.week}`)),...entries],'项目总览：手动排班');setMessage('排班已保存，相关页面已同步。');}}/>}
    {editing?.kind==='task-scope'&&item&&<UtilityDialog title="选择 Task 编辑范围" detail="选择范围后设置日期；生成、复用和保存规则与节点管理一致。" onClose={()=>setEditing(null)} className="overview-task-scope-dialog">
      <div className="overview-task-scope-options">
        <button className="glass-btn" aria-label="编辑本项目 Task" onClick={()=>setEditing({...editing,kind:'tasks',scope:'project'})}><strong>编辑本项目 Task</strong><span>{item.name} · {item.code}</span><small>仅生成、编辑、保存与导出本项目任务</small></button>
        <button className="glass-btn" aria-label="编辑全部项目 Task" onClick={()=>setEditing({...editing,kind:'tasks',scope:'all'})}><strong>编辑全部项目 Task</strong><span>所选日期内的全部项目</span><small>与节点管理的 Task List 使用相同范围</small></button>
      </div>
    </UtilityDialog>}
    {editing?.kind==='tasks'&&item&&<TaskListBuilderModal projects={w.data.projects} bookingData={w.data.eicData} defaultStart={selectedSnapshot?.periodStart||(getYearFromFY(fy)-1)+'-07-01'} defaultEnd={selectedSnapshot?.periodEnd||getYearFromFY(fy)+'-06-30'} focusProjectCode={editing.code} projectScope={editing.scope==='project'?item.project:undefined} onSaved={saved=>update({snapshots:{...state.snapshots,[item.code]:saved.id}})} onClose={()=>setEditing(null)}/>}
  </div>;
}
