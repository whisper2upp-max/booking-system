// Embedded into the offline HTML by scripts/sync_workspace.py.
const WorkspaceContext=React.createContext(null);
const BUSINESS_NAMES={masterData:'人员主数据',eicData:'EIC 排班',ouData:'OU 排班',budgetData:'项目预算',rates:'小时费率',timesheetData:'实际工时',projects:'项目与节点',taskLists:'Task 存档',matches:'Pending 对应关系'};

function normalizeWorkspace(data){
  ['eicData','ouData'].forEach(key=>{data[key]=data[key].map(entry=>{
    const e=normalizeEntryWeek({...entry});
    return {...e,name:BookingStaff.isChineseName(e.name)?e.name:normalizeName(e.name),eic:normalizeName(e.eic),level:normalizeLevel(e.level)||e.level};
  });});
  data.budgetData=data.budgetData.map((b,i)=>({...b,id:b.id||'legacy_'+i,engagementCode:String(b.engagementCode||''),engagementName:String(b.engagementName||''),budgetHrs:Number(b.budgetHrs)||0,budgetSER:Number(b.budgetSER)||0,benchmark:b.benchmark==='SER'?'SER':'hrs',remark:String(b.remark||'')}));
  data.rates={...DEFAULT_RATES,...data.rates};
  data.timesheetData=data.timesheetData.map(e=>({...e,employeeName:normalizeName(e.employeeName),level:normalizeLevel(e.level)||e.level}));
  data.projects=data.projects.map(p=>({...p,fic:normalizeName(p.fic),eic:normalizeName(p.eic),teamFic:normalizeName(p.teamFic)}));
  return data;
}
function reconcileProjectIdentity(data,previous){
  if(!previous)return;
  data.projects.forEach(project=>{
    const old=previous.projects.find(p=>p.id===project.id);
    if(!old||(old.code===project.code&&old.name===project.name))return;
    if(old.code!==project.code){
      if(old.code&&!project.code)throw Error('已有项目的 Code 不能清空。');
      const occupied=project.code&&(data.projects.some(p=>p.id!==project.id&&p.code===project.code)||['eicData','ouData','budgetData','timesheetData'].some(key=>data[key].some(row=>row.engagementCode===project.code)));
      if(occupied)throw Error('项目 Code '+project.code+' 已存在，不能覆盖或合并其他项目。');
    }
    ['eicData','ouData','budgetData','timesheetData'].forEach(key=>{
      data[key]=data[key].map(row=>old.code&&row.engagementCode===old.code?{...row,engagementCode:project.code,engagementName:project.name}:row);
    });
    const belongs=item=>(item.projectId&&item.projectId===old.id)||(old.code&&item.projectCode===old.code);
    data.taskLists=data.taskLists.map(snapshot=>({...snapshot,
      tasks:snapshot.tasks.map(task=>belongs(task)?{...task,projectCode:project.code,
        ...(task.sourceProjectName===old.name?{sourceProjectName:project.name}:{}),
        ...(task.engagementName===old.name?{engagementName:project.name}:{})}:task),
      ...(snapshot.sourceMeta?{sourceMeta:Object.fromEntries(Object.entries(snapshot.sourceMeta).map(([key,meta])=>[key,belongs(meta)?{...meta,projectCode:project.code}:meta]))}:{})
    }));
  });
}
function reconcileWorkspace(data,previous){
  reconcileProjectIdentity(data,previous);
  const changed=key=>!previous||JSON.stringify(data[key])!==JSON.stringify(previous[key]);
  if(changed('eicData')){
    const codes=new Map();
    data.eicData.forEach(e=>{if(e.engagementCode)codes.set(e.engagementCode,e.engagementName||e.engagementCode);});
    const derived=Array.from(codes,([code,name])=>{
      const existing=data.projects.find(p=>p.code===code);
      return existing?{...existing,name:name||existing.name}:{id:'pn_'+Date.now()+'_'+Math.random().toString(36).slice(2),name,code,fic:'',section:'',papers:'',budget:'',eic:'',teamFic:'',serviceOrderNo:'',orderNo:'',nodes:[]};
    });
    data.projects=[...derived,...data.projects.filter(p=>p.code&&!codes.has(p.code))];
  }
  if(changed('budgetData')||changed('eicData')){
    data.projects=data.projects.map(p=>{
      const b=data.budgetData.find(row=>row.engagementCode===p.code);
      return b?{...p,budget:String(b.budgetHrs)}:p;
    });
  }
  return data;
}
function App(){
  const [loaded]=useState(()=>{
    try{const store=BookingWorkspace.create(localStorage,{
      defaults:{masterData:STAFF_MASTER.map(p=>({...p,fic:p.fic||''})),eicData:[],ouData:[],budgetData:[],rates:DEFAULT_RATES,timesheetData:[],projects:[],taskLists:[],matches:{}},
      normalize:normalizeWorkspace,reconcile:reconcileWorkspace
    });
    const defaultsByEmail=new Map(STAFF_MASTER.map(p=>[p.email.toLowerCase(),p]));
    if(store.getState().masterData.some(p=>!String(p.fic||'').trim()&&defaultsByEmail.get(p.email.toLowerCase())?.fic)){
      store.commit('补齐人员主数据 FIC',d=>{d.masterData=d.masterData.map(p=>!String(p.fic||'').trim()&&defaultsByEmail.get(p.email.toLowerCase())?.fic?{...p,fic:defaultsByEmail.get(p.email.toLowerCase()).fic}:p);});
    }
    const data=store.getState();
    BookingStaff.setMaster(data.masterData);
    const choices={};
    BookingStaff.listPending(data.eicData,data.ouData,STAFF_MASTER,data).forEach(p=>{
      const targets=STAFF_MASTER.filter(person=>person.chineseName===p.name&&person.status==='active');
      if(targets.length===1)choices[p.name]=targets[0].email;
    });
    if(Object.keys(choices).length){
      const plan=BookingStaff.createMatchPlan(data,choices,data.matches,STAFF_MASTER);
      store.commit('主数据：中文姓名自动匹配',d=>{['eicData','ouData','projects','taskLists','matches','timesheetData','masterData'].forEach(key=>{if(plan[key]!==undefined)d[key]=plan[key];});});
    }
    return {store};}catch(e){return {error:e.message};}
  });
  const store=loaded.store;
  const [revision,setRevision]=useState(0), [error,setError]=useState('');
  const [page,setPage]=useState(()=>window.location.hash==='#project-overview'?'project-overview':'main'),[eicSub,setEicSub]=useState('booking'),[ouSub,setOuSub]=useState('booking');
  const [showPendingMatch,setShowPendingMatch]=useState(false),[showHistory,setShowHistory]=useState(false),[help,setHelp]=useState(null);
  const [overviewState,setOverviewState]=useState({});
  const [timelineView,setTimelineView]=useState(null);
  const [today,setToday]=useState(()=>dayjs().format('YYYY-MM-DD'));
  useEffect(()=>store?store.subscribe(()=>setRevision(n=>n+1)):undefined,[store]);
  useEffect(()=>{const timer=setInterval(()=>setToday(dayjs().format('YYYY-MM-DD')),60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const changed=e=>{if(e.key===BookingWorkspace.KEY)setError('另一窗口已更新数据。请刷新此窗口后继续编辑。');};
    window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);
  },[]);
  const run=useCallback(fn=>{try{const result=fn();setError('');return result;}catch(e){setError(e.message);throw e;}},[]);
  const commit=useCallback((label,producer)=>run(()=>{if(BookingTeams.metadata(store.getState()).sources.length&&!['设置维护身份','登记旧版来源'].includes(label))throw Error('当前为 EIC 汇总数据，请由对应 FIC 修正后重新提交；可在备份页面更新来源或撤销。');return store.commit(label,producer);}),[store,run]);
  const undo=useCallback(()=>{try{run(()=>store.undo());}catch(e){}},[store,run]);
  const redo=useCallback(()=>{try{run(()=>store.redo());}catch(e){}},[store,run]);
  const restoreTo=useCallback(id=>{try{run(()=>store.restoreTo(id));}catch(e){}},[store,run]);
  useEffect(()=>{
    if(!store)return;
    const handler=e=>{
      if(!historyShortcut(e)||document.querySelector('.modal-overlay'))return;
      e.preventDefault();isRedoShortcut(e)?redo():undo();
    };
    document.addEventListener('keydown',handler);return()=>document.removeEventListener('keydown',handler);
  },[store,undo,redo]);
  const data=store?.getState();
  if(data)BookingStaff.setMaster(data.masterData);
  useMemo(()=>{if(data){resetColors();data.eicData.forEach(e=>{if(e.engagementCode)getProjectColor(e.engagementCode);});data.projects.forEach(p=>getProjectColor(p.code||p.id));}},[data]);
  const issues=useMemo(()=>data?buildWorkspaceIssues(data,today):[],[data,today]);
  if(!store)return <div className="workspace-fatal"><WorkspaceBrand/><h2>本地数据暂时无法打开</h2><p role="alert">{loaded.error}</p><p>程序没有清除原数据。请关闭旧版窗口，检查浏览器存储权限或联系管理员。</p><button className="glass-btn" onClick={()=>location.reload()}>重新读取</button></div>;
  const {eicData,ouData,budgetData,rates,timesheetData,projects}=data;
  const history=store.getHistory();
  const setField=(field,label)=>(value)=>commit(label,d=>{d[field]=typeof value==='function'?value(d[field]):value;});
  const replaceEic=(entries,label='更新 EIC 排班')=>commit(label,d=>{d.eicData=entries.map(e=>BookingStaff.prepareEntry(e,d.matches,STAFF_MASTER));});
  const replaceOu=(entries,label='导入 OU 排班')=>commit(label,d=>{d.ouData=entries.map(e=>BookingStaff.prepareEntry(e,d.matches,STAFF_MASTER));});
  const setBudgetData=setField('budgetData','导入项目预算'),setRates=setField('rates','修改小时费率'),setTimesheetData=setField('timesheetData','导入实际工时');
  const updateProjects=(next,label='更新项目与节点')=>setField('projects',label)(next);
  const addBudgetRow=()=>commit('新增项目预算',d=>{d.budgetData.push({id:makeTaskListId('budget'),engagementCode:'',engagementName:'',budgetHrs:0,budgetSER:0,benchmark:'hrs',remark:''});});
  const updateBudgetRow=(id,updates)=>commit('编辑项目预算',d=>{d.budgetData=d.budgetData.map(row=>row.id===id?{...row,...updates}:row);});
  const deleteBudgetRow=id=>commit('删除项目预算',d=>{d.budgetData=d.budgetData.filter(row=>row.id!==id);});
  const pendingPeople=BookingStaff.listPending(eicData,ouData,STAFF_MASTER,data);
  const applyPendingMatches=choices=>{
    let plan;
    commit('匹配 Pending 人员',d=>{
      plan=BookingStaff.createMatchPlan(d,choices,d.matches,STAFF_MASTER);
      ['eicData','ouData','projects','taskLists','matches','timesheetData','masterData'].forEach(key=>{if(plan[key]!==undefined)d[key]=plan[key];});
    });
    return plan;
  };
  const clearAllData=()=>commit('清除全部业务数据',d=>{Object.keys(d).filter(k=>k!=='masterData').forEach(k=>{d[k]=k==='rates'?{...DEFAULT_RATES}:k==='matches'?{}:[];});});
  const go=(next,sub)=>{if(next!=='project-overview'&&next!=='project-timeline')setTimelineView(null);setPage(next);if(next==='eic'&&sub)setEicSub(sub);if(next==='ou'&&sub)setOuSub(sub);};
  const openProjectOverview=(project,view)=>{
    if(!project.code)return;
    const eics=new Set([project.eic,...eicData.filter(row=>row.engagementCode===project.code).map(row=>row.eic)].filter(Boolean));
    setTimelineView(view);
    setOverviewState(prev=>({...prev,projectCode:project.code,eic:prev.eic&&eics.has(prev.eic)?prev.eic:project.eic||(eics.size===1?Array.from(eics)[0]:''),scrollTop:0,scrollLeft:0}));
    setPage('project-overview');
  };
  const context={data,history,commit,undo,redo,restoreTo,issues,page,eicSub,ouSub,applyPendingMatches,replaceEic,replaceOu,updateBudgetRow,updateProjects,setBudgetData,addBudgetRow,deleteBudgetRow,setRates,setTimesheetData,
    openHistory:()=>setShowHistory(true),openHelp:(id)=>setHelp(typeof id==='string'?id:page==='project-overview'?'overview':page==='eic'?eicSub==='budget'?'budget':['idle','ut'].includes(eicSub)?'capacity':['import','company'].includes(eicSub)?'imports':'booking':page==='ou'?'ou':page==='project-timeline'?'nodes':page==='issues'?'issues':'start'),
    openIssues:()=>go('issues'),go,
    saveMaster:(rows,identity)=>commit('更新人员主数据',d=>applyMasterDataChange(d,rows,identity)),
    exportAll:()=>{const {ouData,...eic}=store.getState();return JSON.parse(JSON.stringify(eic));},
    restoreAll:next=>{run(()=>store.replaceAll({...next,ouData:store.getState().ouData}));setOverviewState({});setTimelineView(null);},
    saveTasks:next=>commit('保存 Task List',d=>{d.taskLists=next;})};
  let content=null;
  if(page==='master-data')content=<MasterDataPanel onBack={()=>go('main')}/>;
  if(page==='backup')content=<div className="sub-app"><WorkspaceHeader section="数据备份与恢复" onBack={()=>go('main')}/><main className="backup-workspace"><FullBackupControls/></main></div>;
  if(page==='main')content=<MainPage onGo={go} onClear={clearAllData}/>;
  if(page==='eic')content=<EICApp data={eicData} budgetData={budgetData} rates={rates} onReplace={replaceEic} setBudgetData={setBudgetData} addBudgetRow={addBudgetRow} updateBudgetRow={updateBudgetRow} deleteBudgetRow={deleteBudgetRow} onRatesChange={setRates} timesheetData={timesheetData} setTimesheetData={setTimesheetData} sub={eicSub} setSub={setEicSub} onBack={()=>go('main')} pendingCount={pendingPeople.length} onMatchPending={()=>setShowPendingMatch(true)}/>;
  if(page==='ou')content=<OUApp ouData={ouData} eicData={eicData} onReplace={replaceOu} sub={ouSub} setSub={setOuSub} onBack={()=>go('main')}/>;
  if(page==='project-timeline')content=<ProjectTimelineApp projects={projects} bookingData={eicData} updateProjects={updateProjects} initialView={timelineView} onOpenOverview={openProjectOverview} onBack={()=>go('main')}/>;
  if(page==='project-overview')content=<ProjectOverview state={overviewState} setState={setOverviewState} onBack={()=>go('main')} onBackToTimeline={()=>go('project-timeline')}/>;
  if(page==='issues')content=<AnomalyCenter onBack={()=>go('main')}/>;
  return <WorkspaceContext.Provider value={context}>{content}<AutoBackupManager/>
    {error&&<div className="workspace-error" role="alert"><UIIcon name="alert"/><span>{error}</span><button onClick={()=>setError('')} aria-label="关闭提示">×</button></div>}
    {showPendingMatch&&<PendingStaffMatcher eicData={eicData} ouData={ouData} projects={projects} pendingPeople={pendingPeople} onApply={applyPendingMatches} onClose={()=>setShowPendingMatch(false)}/>}
    {showHistory&&<WorkspaceHistory onClose={()=>setShowHistory(false)}/>}
    {help&&<UsageGuide initialSection={help} onClose={()=>setHelp(null)}/>}
  </WorkspaceContext.Provider>;
}
function historyShortcut(e){
  return !e.isComposing&&!e.altKey&&(e.metaKey||e.ctrlKey)&&['z','y'].includes(e.key.toLowerCase())&&!e.target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"]');
}
function isRedoShortcut(e){return e.key.toLowerCase()==='y'||e.shiftKey;}
function WorkspaceTools(){
  const w=React.useContext(WorkspaceContext);
  if(!w)return null;
  const past=w.history.past,future=w.history.future;
  return <div className="workspace-tools" aria-label="全局工具">
    <div className="history-controls">
      <button className="glass-btn" disabled={!past.length} onClick={w.undo} aria-label="全局撤销" title={past.length?'撤销：'+past[past.length-1].label:'暂无可撤销操作'}><span aria-hidden="true">↶</span><span className="tool-text">撤销</span></button>
      <button className="glass-btn" disabled={!future.length} onClick={w.redo} aria-label="全局重做" title={future.length?'重做：'+future[future.length-1].label:'暂无可重做操作'}><span aria-hidden="true">↷</span><span className="tool-text">重做</span></button>
      <button className="glass-btn history-list-trigger" onClick={w.openHistory} aria-label="操作历史" title="查看操作历史">历史</button>
    </div>
    <button className={'glass-btn issue-trigger'+(w.page==='issues'?' active':'')} onClick={w.openIssues}><UIIcon name="alert"/><span>异常待办</span><b>{w.issues.length}</b></button>
    <div className="workspace-admin-tools"><button className="glass-btn" onClick={()=>w.go('master-data')}>管理人员主数据</button><button className="glass-btn" onClick={()=>w.go('backup')}>数据备份与恢复</button>
    <button className="glass-btn guide-trigger" onClick={()=>w.openHelp()}><UIIcon name="file"/>使用说明</button></div>
  </div>;
}
function WorkspaceHistory({onClose}){
  const w=React.useContext(WorkspaceContext);
  const {past,future,notice}=w.history;
  const current=past[past.length-1];
  const [selected,setSelected]=useState(()=>current?.id||future[future.length-1]?.id||null);
  const timeline=[...past,...future.slice().reverse()];
  const entries=timeline.map((e,i)=>({...e,done:i<past.length,steps:i+1-past.length})).reverse();
  const active=entries.find(e=>e.id===selected);
  return <UtilityDialog title="操作历史" detail="所有模块共用一条时间线 · 最近最多 50 步 · 刷新后保留" onClose={onClose} className="history-dialog">
    <div className="utility-actions"><button className="glass-btn" disabled={!past.length} onClick={w.undo}>↶ 撤销{past.length?' · '+past[past.length-1].label:''}</button><button className="glass-btn" disabled={!future.length} onClick={w.redo}>↷ 重做{future.length?' · '+future[future.length-1].label:''}</button></div>
    <p className="utility-note">新修改会清空重做分支。搜索、筛选和滚动不计入历史；下载的文件不随撤销改变。清除业务数据也可在历史保留期间撤销。</p>
    <p className="history-position" role="status">当前位置：{current?current.label+' · 完成后':future.length?'最早保留操作之前':'暂无已保存的操作'}</p>
    {notice&&<p className="utility-note warning">{notice}</p>}
    <div className="history-body"><div className="history-list">{entries.length===0?<p className="empty-state">开始编辑后，操作将显示在这里。</p>:entries.map(e=><button key={e.id} className={'history-entry'+(selected===e.id?' selected':'')+(current?.id===e.id?' current':'')} aria-current={current?.id===e.id?'step':undefined} onClick={()=>setSelected(e.id)}><span className={'history-state'+(e.done?' done':'')+(current?.id===e.id?' current':'')}>{current?.id===e.id?'当前位置':e.done?'已生效':'已撤销'}</span><strong>{e.label}</strong><small>{new Date(e.time).toLocaleString('zh-CN')}</small><span>{e.changes.map(p=>BUSINESS_NAMES[p.key]).join(' · ')}</span></button>)}</div>
      <div className="history-detail">{active?<><div className="history-restore"><div className="history-detail-heading"><h4>{active.label}</h4><button className="glass-btn primary-btn history-restore-btn" disabled={active.steps===0} onClick={()=>w.restoreTo(active.id)}>恢复到此步之后</button></div><p>{active.steps===0?'当前已处于这一步完成后的状态。':`将${active.steps<0?'撤销':'重做'} ${Math.abs(active.steps)} 步，恢复该操作完成后的各模块业务数据；后续记录仍可切回。`}</p></div>{active.changes.map(p=><section key={p.key}><h5>{BUSINESS_NAMES[p.key]}</h5><div className="change-columns"><div><strong>修改前</strong><pre>{formatHistoryValue(p.key,p.before)}</pre></div><div><strong>修改后</strong><pre>{formatHistoryValue(p.key,p.after)}</pre></div></div></section>)}</>:<p>选择一条记录，查看修改前后内容，并恢复到这一步完成后的状态。</p>}</div>
    </div>
  </UtilityDialog>;
}
function formatHistoryValue(key,value){
  if(key==='rates')return Object.entries(value).map(([level,rate])=>level+'：'+fmt(rate)).join('\n');
  if(key==='matches')return Object.entries(value).map(([name,target])=>name+' → '+target.name+(target.email?'（'+target.email+'）':'')).join('\n')||'无对应关系';
  if(!value.length)return '无记录';
  return value.map(row=>{
    if(key==='eicData'||key==='ouData')return `${row.name} · ${row.level}\n${row.engagementName}（${row.engagementCode}）\n${row.week} · ${fmt(row.hrs)}h · EIC ${row.eic||'未填写'}`;
    if(key==='budgetData')return `${row.engagementName||'未命名'}（${row.engagementCode||'未填 Code'}）\n预算 ${fmt(row.budgetHrs)}h / SER ${fmt(row.budgetSER)} · 基准 ${row.benchmark==='SER'?'SER':'工时'}\n备注：${row.remark||'无'}`;
    if(key==='timesheetData')return `${row.employeeName} · ${row.level}\n${row.engagementCode} · ${fmt(row.hrs)}h`;
    if(key==='projects')return `${row.name}（${row.code}）\nFIC ${row.fic||'未填写'} · 项目组 FIC ${row.teamFic||'未填写'} · EIC ${row.eic||'未填写'}\nSection ${row.section||'未填写'} · 底稿 ${row.papers||'未填写'} · 预算 ${row.budget||'未填写'}\n服务单号 ${row.serviceOrderNo||'未填写'} · 订单号 ${row.orderNo||'未填写'}\n`+(row.nodes||[]).map(n=>`${n.date||n.week} ${n.name} · ${n.completed==='Y'?'已完成':n.completed==='N'?'未完成':'待确认'}${n.delayed?'（延迟）':''}${n.actualDate?' · 实际 '+n.actualDate:''}${n.note?'\n说明：'+n.note:''}`).join('\n');
    if(key==='taskLists')return `${row.periodStart} 至 ${row.periodEnd} · ${(row.tasks||[]).length} 条 Task · ${(row.deletedSources||[]).length} 个已删除来源\n`+(row.tasks||[]).map(t=>`${t.engagementName} · ${t.nodeName}\n${t.startDate||'未填开始日'} → ${t.dueDate||'未填截止日'}\n分工：${(t.assignees||[]).join('、')||'未分配'}\n${t.taskDescription||'未填描述'}${t.splitGroupId?'（已拆分）':''}`).join('\n\n');
    return '';
  }).join('\n\n');
}
function ImportChoiceDialog({choice,onChange,onSelect,onClose}){
  const workspace=React.useContext(WorkspaceContext);
  return <UtilityDialog title="导入排班" detail="先选择覆盖方式，再选择文件来源。" onClose={onClose} closeOnBackdrop className="import-choice-dialog">
    <fieldset className="import-choice-section"><legend><span>1</span>选择覆盖方式</legend>
      <div className="import-choice-grid">
        <button type="button" className={'import-mode-option'+(choice==='replace'?' selected':'')} aria-label="替换全部已有排班数据" aria-pressed={choice==='replace'} onClick={()=>onChange('replace')}><span className="import-choice-dot" aria-hidden="true"/><span><strong>替换全部已有排班数据</strong><small>以本次文件重建整个 EIC 排班</small></span></button>
        <button type="button" className={'import-mode-option'+(choice==='append'?' selected':'')} aria-label="补充新排班" aria-pressed={choice==='append'} onClick={()=>onChange('append')}><span className="import-choice-dot" aria-hidden="true"/><span><strong>补充新排班</strong><small>保留已有排班，遇到冲突再选择</small></span></button>
      </div>
      <p className="import-choice-summary" role="status">{choice==='replace'?'替换范围包含所有财年、人员和项目的 EIC 排班，不受当前筛选限制。':'同一人员、同一周、同一 EIC 已有排班时，会继续询问覆盖或补充。'}</p>
    </fieldset>
    <fieldset className="import-choice-section"><legend><span>2</span>选择文件来源</legend>
      <div className="import-choice-grid">
        <button type="button" className="import-source-option" aria-label="Booking Template" onClick={()=>onSelect('import')}><span className="import-source-icon"><UIIcon name="file"/></span><span><strong>Booking Template</strong><small>标准排班文件</small></span><span className="import-source-arrow" aria-hidden="true">→</span></button>
        <button type="button" className="import-source-option" aria-label="排班小工具数据" onClick={()=>onSelect('company')}><span className="import-source-icon"><UIIcon name="building"/></span><span><strong>排班小工具数据</strong><small>公司排班导出文件</small></span><span className="import-source-arrow" aria-hidden="true">→</span></button>
      </div>
    </fieldset>
    <div className="import-choice-footer"><button type="button" className="import-rules-link" onClick={()=>{onClose();workspace.openHelp('imports');}}>查看覆盖规则</button><button type="button" className="glass-btn" onClick={onClose}>取消</button></div>
  </UtilityDialog>;
}
function UtilityDialog({title,detail,onClose,className='',closeOnBackdrop=false,children}){
  const ref=useRef(null);
  useEffect(()=>{
    const old=document.activeElement;ref.current?.focus();
    const handler=e=>{
      if(e.key==='Escape'&&!document.querySelector('.person-picker-menu')){e.stopPropagation();onClose();}
      if(e.key==='Tab'){
        const items=Array.from(ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select,textarea,[tabindex="0"]')).filter(el=>el.getClientRects().length);
        const first=items[0],last=items[items.length-1];
        if(e.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){e.preventDefault();last?.focus();}
        if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    const element=ref.current;element.addEventListener('keydown',handler);
    return()=>{element.removeEventListener('keydown',handler);old?.isConnected&&old.focus();};
  },[]);
  return <div className="modal-overlay utility-overlay" onClick={closeOnBackdrop?e=>{if(e.target===e.currentTarget)onClose();}:undefined}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={'modal glass-card utility-dialog '+className}><div className="utility-heading"><div><h3>{title}</h3>{detail&&<p>{detail}</p>}</div><button className="glass-btn" aria-label="关闭窗口" onClick={onClose}><UIIcon name="close"/></button></div>{children}</div></div>;
}
function useTaskDraft(){
  const empty=()=>({tasks:[],coveredSourceKeys:[],deletedSources:[]});
  const ref=useRef({value:empty(),past:[],future:[],group:null});
  const [,refresh]=useState(0);
  const publish=()=>refresh(n=>n+1);
  const reset=useCallback(value=>{ref.current={value,past:[],future:[],group:null};publish();},[]);
  const change=useCallback((label,producer,group=null)=>{
    const state=ref.current,before=state.value,next=JSON.parse(JSON.stringify(before));producer(next);
    if(JSON.stringify(before)===JSON.stringify(next))return;
    if(!group||state.group!==group)state.past=[...state.past,{value:before,label}].slice(-50);
    state.value=next;state.future=[];state.group=group;publish();
  },[]);
  const undo=useCallback(()=>{
    const s=ref.current,last=s.past[s.past.length-1];if(!last)return;
    s.future.push({value:s.value,label:last.label});s.value=last.value;s.past.pop();s.group=null;publish();
  },[]);
  const redo=useCallback(()=>{
    const s=ref.current,last=s.future[s.future.length-1];if(!last)return;
    s.past.push({value:s.value,label:last.label});s.value=last.value;s.future.pop();s.group=null;publish();
  },[]);
  return {value:ref.current.value,past:ref.current.past,future:ref.current.future,reset,change,undo,redo,closeGroup:()=>{ref.current.group=null;}};
}
function taskSourceKey(task){
  return task.sourceKey||(task.projectId&&task.nodeId?task.projectId+'::'+task.nodeId:'');
}
function taskListProjectCatalog(projects,bookingData=[],budgetData=[]){
  const catalog=new Map();
  projects.forEach(p=>{if(p.code||p.id)catalog.set(p.code||'id:'+p.id,{...p,name:p.name||p.code||''});});
  [...bookingData,...budgetData].forEach(row=>{
    const code=String(row.engagementCode||'').trim();
    if(code&&!catalog.has(code))catalog.set(code,{id:'',code,name:row.engagementName||code,eic:''});
  });
  return Array.from(catalog.values()).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')||String(a.code||'').localeCompare(String(b.code||'')));
}
function taskListProjectValue(project){return project.id?'id:'+project.id:'code:'+project.code;}
function resolveTaskListProject(task,projects){
  return (task.projectId&&projects.find(p=>p.id===task.projectId))||(task.projectCode&&projects.find(p=>p.code===task.projectCode))||null;
}
function taskListProjectFields(project){
  return {projectId:project.id||'',projectCode:project.code||'',sourceProjectName:project.name,sourceManager:normalizeName(String(project.eic||'').trim()),engagementName:project.name};
}
function selectManualTaskProject(draft,taskId,project){
  const task=draft.tasks.find(t=>t.id===taskId);
  if(!task?.isManual||!project)return;
  const oldKey=taskSourceKey(task),sameProject=overviewTaskMatches(task,project);
  const nextKey=sameProject?oldKey:overviewTaskSourcePrefix(project)+'manual::'+task.id;
  draft.tasks=draft.tasks.map(t=>t.id===taskId?{...t,...taskListProjectFields(project),sourceKey:nextKey}:t);
  draft.coveredSourceKeys=Array.from(new Set([...draft.coveredSourceKeys,nextKey]));
  // A moved manual row gets its own source, so split siblings and older periods
  // retain the correct project ownership. The old source stays deleted if empty.
  if(oldKey&&oldKey!==nextKey){
    draft.deletedSources=draft.deletedSources.filter(d=>d.sourceKey!==oldKey&&d.sourceKey!==nextKey);
    const date=normalizeTaskListDate(task.sourceDate||task.dueDate);
    if(date&&!draft.tasks.some(t=>taskSourceKey(t)===oldKey))draft.deletedSources.push({sourceKey:oldKey,sourceDate:date});
  }
}
function useTaskRowHeights(tableRef,tasks,step){
  React.useLayoutEffect(()=>{
    const wrap=tableRef.current;
    if(step!=='editor'||!wrap)return;
    let width=wrap.clientWidth;
    const fit=()=>{
      const rows=Array.from(wrap.querySelectorAll('tbody tr'));
      rows.forEach(row=>row.style.removeProperty('--task-row-height'));
      const heights=rows.map(row=>Math.ceil(Math.max(48,...Array.from(row.querySelectorAll('[data-task-field],.task-action-content')).map(field=>{
        const bounds=field.getBoundingClientRect();
        return field.tagName==='TEXTAREA'?Math.max(bounds.height,field.scrollHeight+2):bounds.height;
      }))));
      rows.forEach((row,i)=>row.style.setProperty('--task-row-height',heights[i]+'px'));
    };
    fit();
    const observer=new ResizeObserver(()=>{if(wrap.clientWidth!==width){width=wrap.clientWidth;fit();}});
    observer.observe(wrap);
    return()=>observer.disconnect();
  },[tableRef,tasks,step]);
}
function prepareTaskListPeriod(projects,snapshots,periodStart,periodEnd,projectScope){
  const selected=projectScope?projects.filter(p=>overviewTaskMatches({projectId:p.id,projectCode:p.code},projectScope)):projects;
  const generated=buildTaskListRows(selected,periodStart,periodEnd);
  let overlaps=snapshots.filter(s=>s.periodStart<=periodEnd&&s.periodEnd>=periodStart);
  if(projectScope)overlaps=overlaps.map(s=>overviewProjectTaskDraft(s,projectScope)).filter(s=>s.tasks.length||s.coveredSourceKeys.length||s.deletedSources.length);
  const time=s=>projectScope?overviewTaskSnapshotTime(s,projectScope):String(s.updatedAt||s.savedAt||'');
  overlaps.sort((a,b)=>time(b).localeCompare(time(a)));
  return {generated,overlaps};
}
function taskSourceMetadata(previous,tasks,coverage,archives=[]){
  const meta={},keys=new Set(coverage||[]);
  tasks.forEach(task=>{const key=taskSourceKey(task);if(key)keys.add(key);});
  // Retain ownership even when the last task is deleted or reused into another period.
  keys.forEach(key=>{
    for(const snapshot of [previous,...archives]){
      const old=snapshot?.sourceMeta?.[key]||snapshot?.tasks?.find(task=>taskSourceKey(task)===key);
      if(old&&(old.projectId||old.projectCode)){meta[key]={projectId:old.projectId||'',projectCode:old.projectCode||''};break;}
    }
  });
  tasks.forEach(task=>{const key=taskSourceKey(task);if(key&&(task.projectId||task.projectCode))meta[key]={projectId:task.projectId||'',projectCode:task.projectCode||''};});
  return meta;
}
function taskSnapshotsForReuse(snapshots){
  // A project-only save updates its sources, not every project in the same archive.
  // Split by source revision before the existing newest-first reuse/deletion merge.
  return snapshots.flatMap(snapshot=>{
    if(!snapshot.fullUpdatedAt)return [snapshot];
    const keys=new Set([...(snapshot.coveredSourceKeys||[]),...snapshot.tasks.map(taskSourceKey),...(snapshot.deletedSources||[]).map(d=>d.sourceKey)]),groups=new Map();
    keys.forEach(key=>{if(!key)return;const time=snapshot.sourceMeta?.[key]?.updatedAt||snapshot.fullUpdatedAt;if(!groups.has(time))groups.set(time,new Set());groups.get(time).add(key);});
    return Array.from(groups,([updatedAt,owned])=>({...snapshot,updatedAt,
      tasks:snapshot.tasks.filter(task=>owned.has(taskSourceKey(task))),coveredSourceKeys:Array.from(owned),
      deletedSources:(snapshot.deletedSources||[]).filter(d=>owned.has(d.sourceKey))}));
  }).sort((a,b)=>String(b.updatedAt||b.savedAt||'').localeCompare(String(a.updatedAt||a.savedAt||'')));
}
function readProjectNodeImportRows(sheet){
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});
  const clean=value=>String(value??'').normalize('NFKC').replace(/\uFEFF/g,'').split(/[（(]/)[0].replace(/[.\s_-]/g,'').toLowerCase();
  const headers=(rows[0]||[]).map(clean),aliases={
    code:['Engagement Code','项目编码','项目Code'],fic:['FIC'],section:['Section','主要承接Section范围'],papers:['底稿数规模','底稿规模'],
    eic:['项目组EIC'],teamFic:['项目组FIC'],serviceOrderNo:['服务单号'],orderNo:['订单号'],canvasId:['Canvas ID'],
    nodeName:['节点名称'],nodeGroup:['节点分组'],date:['具体日期'],completed:['完成状态'],note:['进展说明','进度说明']
  };
  const columns=Object.fromEntries(Object.entries(aliases).map(([key,names])=>{
    const accepted=new Set(names.map(clean)),matches=headers.flatMap((h,i)=>accepted.has(h)?[i]:[]);
    if(matches.length>1)throw Error('表头重复：'+names[0]+'，请只保留一列。');
    return [key,matches[0]??-1];
  }));
  if(columns.code<0)throw Error('缺少 Engagement Code 列，无法匹配已有项目。');
  const offset=XLSX.utils.decode_range(sheet['!ref']||'A1').s;
  return rows.slice(1).flatMap((row,index)=>{
    if(row.every(value=>String(value??'').trim()===''))return [];
    const rowNumber=offset.r+index+2,fields={rowNumber};
    Object.entries(columns).forEach(([key,column])=>{
      let value=column<0?'':row[column]??'';
      if(['code','serviceOrderNo','orderNo','canvasId'].includes(key)&&typeof value==='number'){
        if(!Number.isSafeInteger(value))throw Error(`第 ${rowNumber} 行 ${aliases[key][0]} 不是精确整数，请在 Excel 中按文本填写编号后重新导入。`);
        const cell=sheet[XLSX.utils.encode_cell({r:rowNumber-1,c:offset.c+column})],formatted=cell?.w||String(value);
        value=/[eE][+-]?\d+$/.test(formatted)?String(value):formatted;
      }
      fields[key]=value instanceof Date?dayjs(value).format('YYYY-MM-DD'):String(value).trim();
    });
    return [fields];
  });
}
function parseNodeImportDate(value){return isValidWeekRaw(value)?parseWeekString(value):null;}
function nodeImportedStatus(value){
  const status=String(value||'').trim().replace(/（/g,'(').replace(/）/g,')').toUpperCase();
  const delayed=status==='已完成(延迟)'||status==='Y⌛';
  return {completed:delayed||status==='已完成'||status==='Y'?'Y':['未完成','逾期/未完成','未完成/逾期','N'].includes(status)?'N':null,delayed};
}

function workspaceUnion(data){
  const map=new Map();
  [['ou',data.ouData],['eic',data.eicData]].forEach(([source,entries])=>entries.forEach((entry,index)=>{
    map.set(`${entry.name}|${entry.week}|${entry.eic}|${entry.engagementCode}`,{...entry,source,index});
  }));
  return Array.from(map.values());
}
function fmt(value){return Number(value||0).toLocaleString('zh-CN',{maximumFractionDigits:2});}
function workspaceProjectTotals(rows,code,rates){
  return rows.filter(e=>e.engagementCode===code).reduce((s,e)=>({hrs:s.hrs+(Number(e.hrs)||0),SER:s.SER+(Number(e.hrs)||0)*(Number(rates[e.level])||0)}),{hrs:0,SER:0});
}
function buildWorkspaceIssues(data,today){
  const issues=BookingStaff.listPending(data.eicData,data.ouData,STAFF_MASTER,data).map(p=>({id:'pending:'+p.name,type:'pending',title:p.name,detail:`EIC ${p.eicRows} 条 · OU ${p.ouRows} 条 · 引用 ${p.referenceCount||0} 处 · 等待匹配正式人员`,search:[p.name,p.originalName,...p.eics].join(' '),person:p}));
  data.projects.forEach(p=>{
    const missing=!p.fic?.trim(),invalid=!!p.fic&&!BookingStaff.isFicName(p.fic,STAFF_MASTER),invalidTeam=!!p.teamFic&&!BookingStaff.isFicName(p.teamFic,STAFF_MASTER);
    if(missing||invalid||invalidTeam)issues.push({id:'fic:'+p.id,type:'fic',title:p.name||p.code,detail:[missing?'尚未指定 FIC':invalid?'FIC 不在可选范围':'',invalidTeam?'项目组 FIC 不在可选范围':'',p.code].filter(Boolean).join(' · '),search:[p.name,p.code,p.fic,p.teamFic].join(' '),projectId:p.id});
    (p.nodes||[]).filter(n=>n.completed!=='Y'&&n.week<today).forEach(n=>issues.push({id:'overdue:'+p.id+':'+n.id,type:'overdue',title:p.name+' · '+n.name,detail:`计划 ${n.date||n.week} · ${n.completed==='N'?'未完成':'待确认'}${n.note?' · '+n.note:''}`,search:[p.name,p.code,p.fic,n.name,n.note].join(' '),projectId:p.id,nodeId:n.id}));
  });
  const currentWeek=getFridayOfWeek(dayjs(today)).format('YYYY-MM-DD'), groups=new Map();
  workspaceUnion(data).filter(e=>e.week>=currentWeek&&parseWeekString(e.week)).forEach(e=>{
    const key=e.name+'|'+e.week;
    if(!groups.has(key))groups.set(key,{name:e.name,week:e.week,rows:[],hrs:0});
    const group=groups.get(key);group.rows.push(e);group.hrs+=Number(e.hrs)||0;
  });
  Array.from(groups.values()).sort((a,b)=>a.week.localeCompare(b.week)||a.name.localeCompare(b.name)).forEach(g=>{
    const available=getAvailableHrs(dayjs(g.week));
    if(g.hrs>available)issues.push({id:'load:'+g.name+':'+g.week,type:'load',title:g.name,detail:`${g.week} 当周 · 已排 ${fmt(g.hrs)}h / 可用 ${available}h · 超出 ${fmt(g.hrs-available)}h`,search:[g.name,g.week,...g.rows.map(e=>e.engagementName+' '+e.engagementCode+' '+e.eic)].join(' '),name:g.name,week:g.week,available,hrs:g.hrs});
  });
  data.budgetData.filter(b=>b.engagementCode).forEach(b=>{
    const booking=workspaceProjectTotals(data.eicData,b.engagementCode,data.rates),actual=workspaceProjectTotals(data.timesheetData,b.engagementCode,data.rates);
    const key=b.benchmark==='SER'?'SER':'hrs',limit=Number(key==='SER'?b.budgetSER:b.budgetHrs)||0;
    const excess=[booking[key]>limit?'排班超出 '+fmt(booking[key]-limit):'',actual[key]>limit?'实际超出 '+fmt(actual[key]-limit):''].filter(Boolean);
    if(excess.length)issues.push({id:'budget:'+b.id,type:'budget',title:b.engagementName||b.engagementCode,detail:b.engagementCode+' · '+excess.join(' / ')+' '+(key==='hrs'?'小时':'SER'),search:[b.engagementName,b.engagementCode,b.remark].join(' '),budgetId:b.id,code:b.engagementCode,booking,actual});
  });
  return issues;
}
function applyWorkspaceNodeStatus(node,completed,note,actualDate){
  const wasOverdue=node.completed==='N'||isNodeOverdue(node);
  return {...node,completed:completed||null,note:completed==='N'?(note||''):note,delayed:wasOverdue&&completed==='Y'?true:(node.delayed||false),actualDate:actualDate||node.actualDate||''};
}
function AnomalyCenter({onBack}){
  const w=React.useContext(WorkspaceContext),[type,setType]=useState('all'),[query,setQuery]=useState(''),[editing,setEditing]=useState(null),[message,setMessage]=useState('');
  const categories=[['all','全部'],['pending','Pending'],['fic','FIC 信息'],['load','周超负荷'],['budget','预算超支'],['overdue','逾期节点']];
  const names=Object.fromEntries(categories);
  const visible=w.issues.filter(i=>(type==='all'||i.type===type)&&(!query.trim()||(i.search+' '+i.detail).toLowerCase().includes(query.trim().toLowerCase())));
  const done=()=>{setEditing(null);setMessage('已保存，原页面和待办列表已同步。未消除的异常会继续保留。');};
  const issue=editing?.issue,project=issue&&w.data.projects.find(p=>p.id===issue.projectId),node=project?.nodes.find(n=>n.id===issue?.nodeId);
  return <div className="sub-app anomaly-app"><WorkspaceHeader section="异常待办" onBack={onBack}/><div className="anomaly-workspace">
    <div className="view-header"><PageHeading title="异常待办" detail="集中发现，直接处理 · 保存后同步到原页面"/><span className="anomaly-count">{w.issues.length} 项待处理</span></div>
    <div className="anomaly-panel"><div className="anomaly-filters"><nav aria-label="异常类型">{categories.map(([key,label])=><button key={key} className={type===key?'active':''} onClick={()=>setType(key)}>{label}<span>{key==='all'?w.issues.length:w.issues.filter(i=>i.type===key).length}</span></button>)}</nav><input aria-label="搜索异常" placeholder="搜索人员、项目、周或节点" value={query} onChange={e=>setQuery(e.target.value)}/></div>
    <p className="anomaly-rule">周超负荷按 OU 汇总的 EIC 优先口径计算，检查本周及以后；预算沿用各项目的工时 / SER 基准；逾期沿用时间表的周口径。</p>
    {message&&<div className="anomaly-message" role="status">{message}<button aria-label="关闭处理提示" onClick={()=>setMessage('')}>×</button></div>}
    <div className="anomaly-list">{visible.length?visible.map(i=><article className="anomaly-row" key={i.id} data-issue-id={i.id}><span className={'issue-kind '+i.type}>{names[i.type]}</span><div className="anomaly-row-content"><h4>{i.title}</h4><p>{i.detail}</p></div><button className="glass-btn" onClick={()=>{setEditing({kind:i.type,issue:i});setMessage('');}}>{i.type==='pending'?'匹配人员':i.type==='fic'?'补充 FIC':i.type==='load'?'调整排班':i.type==='budget'?'核对处理':'更新状态'}<UIIcon name="arrow"/></button></article>):<div className="anomaly-empty"><UIIcon name="check"/><h4>{w.issues.length?'没有符合筛选条件的待办':'当前没有待处理异常'}</h4><p>{w.issues.length?'可以切换类型或清除搜索条件。':'后续数据变化会自动更新此列表。'}</p></div>}</div>
    <div className="workbench-footer"><span>显示 {visible.length} 项</span><span>处理记录可在全局历史中撤销和重做</span></div></div></div>
    {editing?.kind==='pending'&&<PendingStaffMatcher eicData={w.data.eicData} ouData={w.data.ouData} projects={w.data.projects} pendingPeople={BookingStaff.listPending(w.data.eicData,w.data.ouData,STAFF_MASTER,w.data).filter(p=>p.name===issue.person.name)} onApply={choices=>{const plan=w.applyPendingMatches(choices);setMessage('匹配已保存，相关排班、项目与 Task 已同步。');return plan;}} onClose={()=>setEditing(null)}/>}
    {editing?.kind==='fic'&&project&&<ProjectEditModal project={project} onSave={updates=>{w.commit('待办：补充项目 FIC',d=>{d.projects=d.projects.map(p=>p.id===project.id?{...p,...updates}:p);});done();}} onClose={()=>setEditing(null)}/>}
    {editing?.kind==='overdue'&&node&&<StatusModal project={project} node={node} onSave={(completed,note,actualDate)=>{w.commit('待办：更新节点完成情况',d=>{d.projects=d.projects.map(p=>p.id===project.id?{...p,nodes:p.nodes.map(n=>n.id===node.id?applyWorkspaceNodeStatus(n,completed,note,actualDate):n)}:p);});done();}} onDelete={()=>{if(confirm('删除此节点？可通过全局撤销恢复。')){w.commit('待办：删除逾期节点',d=>{d.projects=d.projects.map(p=>p.id===project.id?{...p,nodes:p.nodes.filter(n=>n.id!==node.id)}:p);});done();}}} onClose={()=>setEditing(null)}/>}
    {(editing?.kind==='load'||editing?.kind==='booking')&&<AnomalyBookingEditor issue={issue} onSaved={done} onClose={()=>setEditing(null)} onImportOU={()=>setEditing({kind:'ou-import'})}/>}
    {editing?.kind==='budget'&&<AnomalyBudgetEditor issue={issue} onSaved={done} onClose={()=>setEditing(null)} onBooking={()=>setEditing({kind:'booking',issue})} onActual={()=>setEditing({kind:'actual'})}/>}
    {editing?.kind==='ou-import'&&<UtilityDialog title="更新 OU 来源排班" detail="复用 OU 导入规则：按文件内的 EIC 替换原有 OU 数据" onClose={()=>setEditing(null)} className="source-import-dialog"><BookingImport type="csv" existingData={w.data.ouData} onReplace={entries=>{w.replaceOu(entries,'待办：导入 OU 排班');done();}}/></UtilityDialog>}
    {editing?.kind==='actual'&&<UtilityDialog title="核对预算与实际工时" detail="可在这里上传修正后的 Timesheet；沿用项目预算模块的校验与保存规则" onClose={()=>setEditing(null)} className="source-budget-dialog"><ProjectBudgetView data={w.data.eicData} budgetData={w.data.budgetData} rates={w.data.rates} setBudgetData={w.setBudgetData} addBudgetRow={w.addBudgetRow} updateBudgetRow={w.updateBudgetRow} deleteBudgetRow={w.deleteBudgetRow} onRatesChange={w.setRates} timesheetData={w.data.timesheetData} setTimesheetData={w.setTimesheetData}/></UtilityDialog>}
  </div>;
}
function editedBookingData(data,edits){
  const byIndex=new Map(edits.map(e=>[e.index,e]));
  const affected=new Set(),key=e=>[e.name,e.week,e.engagementCode,e.eic].join('|');
  const next=data.eicData.flatMap((row,index)=>{
    const edit=byIndex.get(index);if(!edit)return [row];
    if(edit.name===row.name&&Number(edit.hrs)===Number(row.hrs))return [row];
    if(String(edit.hrs).trim()===''||!Number.isFinite(Number(edit.hrs))||Number(edit.hrs)<0)throw new Error('工时须为大于或等于 0 的数字；0 表示删除该条排班。');
    if(!edit.name)throw new Error('请选择排班人员。');
    if(Number(edit.hrs)===0)return [];
    const staff=BookingStaff.resolve(edit.name,data.matches,STAFF_MASTER);
    const changed=BookingStaff.prepareEntry({...row,name:edit.name,hrs:Number(edit.hrs),level:staff?.level||row.level,eic:staff?.eic||row.eic,email:staff?.email||row.email},data.matches,STAFF_MASTER);
    affected.add(key(changed));return [changed];
  });
  const result=[],positions=new Map();
  next.forEach(row=>{
    const k=key(row);
    if(affected.has(k)&&positions.has(k)){const index=positions.get(k);result[index]={...result[index],hrs:Number(result[index].hrs)+Number(row.hrs)};}
    else {positions.set(k,result.length);result.push(row);}
  });
  return result;
}
function AnomalyBookingEditor({issue,onSaved,onClose,onImportOU}){
  const w=React.useContext(WorkspaceContext);
  const matches=e=>issue.type==='load'?e.name===issue.name&&e.week===issue.week:e.engagementCode===issue.code&&(!issue.eic||e.eic===issue.eic)&&(!issue.week||e.week===issue.week)&&(!issue.name||e.name===issue.name);
  const source=w.data.eicData.map((e,index)=>({...e,index})).filter(matches);
  const [edits,setEdits]=useState(()=>source.map(e=>({index:e.index,name:e.name,hrs:e.hrs}))),[error,setError]=useState('');
  const ou=issue.eicOnly?[]:workspaceUnion(w.data).filter(e=>e.source==='ou'&&matches(e));
  const options=Array.from(new Set([...STAFF_MASTER.map(p=>p.name),...source.map(e=>e.name)])).map(personOption);
  const update=(index,values)=>{setEdits(prev=>prev.map(e=>e.index===index?{...e,...values}:e));setError('');};
  let preview=null,previewError='';
  try{preview={...w.data,eicData:editedBookingData(w.data,edits)};}catch(e){previewError=e.message;}
  const impacted=new Set(edits.map(e=>e.name).concat(source.map(e=>e.name)));
  const warnings=preview?buildWorkspaceIssues(preview,dayjs().format('YYYY-MM-DD')).filter(i=>i.type==='load'&&impacted.has(i.name)&&source.some(e=>e.week===i.week)):[];
  const save=()=>{try{w.commit(issue.eicOnly?'项目总览：调整排班':'待办：调整排班',d=>{d.eicData=editedBookingData(d,edits);});onSaved();}catch(e){setError(e.message);}};
  return <UtilityDialog title="调整排班" detail={issue.type==='load'?issue.name+' · '+issue.week+' 当周':issue.title+' · '+issue.code} onClose={onClose} className="booking-resolution-dialog">
    <p className="utility-note">直接调整 EIC 源数据。改派后使用目标人员的 Level / EIC；同人、同项目、同周、同 EIC 的工时合并。填 0 删除该条排班，保存后整批生效。</p>
    <div className="resolution-table-wrap"><table className="resolution-table"><thead><tr><th>项目 / 周</th><th>排班人员</th><th>原工时</th><th>调整后工时</th></tr></thead><tbody>{source.map(row=>{
      const edit=edits.find(e=>e.index===row.index);return <tr key={row.index}><td><strong>{row.engagementName}</strong><small>{row.engagementCode} · {row.week}</small></td><td><PersonPicker label={'调整人员 '+row.engagementCode+' '+row.week} value={edit.name} options={options} onChange={name=>update(row.index,{name})}/></td><td>{fmt(row.hrs)}h</td><td><input aria-label={'调整工时 '+row.engagementCode+' '+row.week} type="number" min="0" step="0.5" value={edit.hrs} onChange={e=>update(row.index,{hrs:e.target.value})}/></td></tr>;
    })}{ou.map((row,i)=><tr className="read-only-row" key={'ou'+i}><td><strong>{row.engagementName}</strong><small>{row.engagementCode} · {row.week}</small></td><td>{row.name}<small>OU 导入来源 · 只读</small></td><td>{fmt(row.hrs)}h</td><td>通过 OU 导入更新</td></tr>)}</tbody></table></div>
    {!source.length&&<p className="utility-note">这些排班来自 OU 导入。请使用下方入口上传修正后的 OU 排班。</p>}
    <div className={'resolution-preview'+(warnings.length?' warning':'')}><strong>保存前预览</strong><p>{previewError|| (warnings.length?`${warnings.length} 个人员周仍超负荷，请核对后决定是否保存。`:'本次涉及的人员周无未来超负荷。')}</p>{warnings.map(i=><small key={i.id}>{i.title} · {i.detail}</small>)}</div>
    {error&&<p role="alert" className="form-error">{error}</p>}
    <div className="modal-actions">{ou.length>0&&<button className="glass-btn" onClick={onImportOU}>导入 OU 排班</button>}<span className="action-spacer"/><button className="glass-btn" onClick={onClose}>取消</button><button className="glass-btn primary-btn" disabled={!source.length||!!previewError} onClick={save}>保存调整</button></div>
  </UtilityDialog>;
}
function AnomalyBudgetEditor({issue,onSaved,onClose,onBooking,onActual}){
  const w=React.useContext(WorkspaceContext),row=w.data.budgetData.find(b=>b.id===issue.budgetId);
  const [draft,setDraft]=useState({...row}),[error,setError]=useState('');
  if(!row)return null;
  const booking=workspaceProjectTotals(w.data.eicData,row.engagementCode,w.data.rates),actual=workspaceProjectTotals(w.data.timesheetData,row.engagementCode,w.data.rates);
  const key=draft.benchmark==='SER'?'SER':'hrs',limit=Number(key==='SER'?draft.budgetSER:draft.budgetHrs)||0;
  const save=()=>{
    if(![draft.budgetHrs,draft.budgetSER].every(n=>String(n).trim()!==''&&Number.isFinite(Number(n))&&Number(n)>=0)){setError('预算须填写大于或等于 0 的数字。');return;}
    try{w.commit('待办：修改项目预算',d=>{d.budgetData=d.budgetData.map(b=>b.id===row.id?{...b,budgetHrs:Number(draft.budgetHrs),budgetSER:Number(draft.budgetSER),benchmark:draft.benchmark,remark:draft.remark}:b);});onSaved();}catch(e){setError(e.message);}
  };
  return <UtilityDialog title="核对预算超支" detail={row.engagementName+' · '+row.engagementCode} onClose={onClose} className="budget-resolution-dialog">
    <table className="resolution-table budget-comparison"><thead><tr><th>口径</th><th>排班</th><th>实际</th><th>当前预算</th></tr></thead><tbody><tr><th>工时</th><td>{fmt(booking.hrs)}</td><td>{fmt(actual.hrs)}</td><td>{fmt(row.budgetHrs)}</td></tr><tr><th>SER</th><td>{fmt(booking.SER)}</td><td>{fmt(actual.SER)}</td><td>{fmt(row.budgetSER)}</td></tr></tbody></table>
    <details className="actual-resolution-details"><summary>实际工时人员明细（{w.data.timesheetData.filter(e=>e.engagementCode===row.engagementCode).length} 条）</summary><div className="resolution-table-wrap"><table className="resolution-table"><thead><tr><th>人员</th><th>Level</th><th>工时</th><th>SER</th></tr></thead><tbody>{w.data.timesheetData.filter(e=>e.engagementCode===row.engagementCode).map((e,i)=><tr key={i}><td>{e.employeeName}</td><td>{e.level}</td><td>{fmt(e.hrs)}</td><td>{fmt((Number(e.hrs)||0)*(Number(w.data.rates[e.level])||0))}</td></tr>)}</tbody></table></div></details>
    <div className="utility-actions"><button className="glass-btn" onClick={onBooking}>查看 / 调整项目排班</button><button className="glass-btn" onClick={onActual}>上传实际工时</button></div>
    <p className="utility-note">先核对排班及实际工时。需要修改预算时，在下方填写批准后的数值；系统不会自动提高预算。</p>
    <div className="resolution-form"><label>预算工时<input type="number" min="0" value={draft.budgetHrs} onChange={e=>setDraft({...draft,budgetHrs:e.target.value})}/></label><label>预算 SER<input type="number" min="0" value={draft.budgetSER} onChange={e=>setDraft({...draft,budgetSER:e.target.value})}/></label><label>预警基准<select value={draft.benchmark} onChange={e=>setDraft({...draft,benchmark:e.target.value})}><option value="hrs">工时</option><option value="SER">SER</option></select></label><label>备注<input value={draft.remark} onChange={e=>setDraft({...draft,remark:e.target.value})}/></label></div>
    <div className="resolution-preview"><strong>按新预算预览</strong><p>{booking[key]>limit?'排班仍超支 '+fmt(booking[key]-limit):'排班未超支'} · {actual[key]>limit?'实际仍超支 '+fmt(actual[key]-limit):'实际未超支'}（{key==='hrs'?'工时':'SER'}）</p></div>
    {error&&<p role="alert" className="form-error">{error}</p>}<div className="modal-actions"><button className="glass-btn" onClick={onClose}>取消</button><button className="glass-btn primary-btn" onClick={save}>保存预算</button></div>
  </UtilityDialog>;
}
function GuideContent({section:s}){
  return <>
    {s.text&&<p>{s.text}</p>}
    {s.details&&<div className="guide-details">{s.details.map((item,i)=><p key={i}><strong>{item.label}：</strong>{item.text}</p>)}</div>}
    {s.steps&&<ol>{s.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>}
    {s.notes&&<ul>{s.notes.map((note,i)=><li key={i}>{note}</li>)}</ul>}
    {s.subsections&&s.subsections.map((sub,i)=><div className="guide-subsection" key={i}><h4>{sub.title}</h4><GuideContent section={sub}/></div>)}
    {s.tip&&<div className="guide-tip">{s.tip}</div>}
    {s.table&&<div className="guide-table-wrap" tabIndex={0} role="region" aria-label={s.table.caption+'，可横向滚动'}><table className="guide-summary-table" aria-label={s.table.caption}><thead><tr>{s.table.headers.map((header,i)=><th scope="col" key={i}>{header}</th>)}</tr></thead><tbody>{s.table.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=>j===0?<th scope="row" key={j}>{cell}</th>:<td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
  </>;
}
function UsageGuide({initialSection,onClose}){
  const [section,setSection]=useState(initialSection),[query,setQuery]=useState(''),articleRef=useRef(null);
  const chapters=BOOKING_GUIDE.filter(c=>!query.trim()||JSON.stringify(c).toLowerCase().includes(query.trim().toLowerCase()));
  const chapter=chapters.find(c=>c.id===section)||chapters[0];
  useEffect(()=>{if(articleRef.current)articleRef.current.scrollTop=0;},[chapter?.id]);
  return <UtilityDialog title="使用说明" detail="Booking System v3.6 · 按模块查阅，支持关键词搜索" onClose={onClose} className="guide-dialog">
    <div className="guide-layout"><aside><input type="search" aria-label="搜索使用说明" placeholder="搜索：导入、Pending、撤销…" value={query} onChange={e=>setQuery(e.target.value)}/><nav aria-label="使用说明目录">{chapters.map((c,i)=><button key={c.id} className={chapter?.id===c.id?'active':''} onClick={()=>setSection(c.id)}><span>{String(BOOKING_GUIDE.indexOf(c)+1).padStart(2,'0')}</span>{c.title}</button>)}</nav></aside>
    <article ref={articleRef}>{chapter?<><p className="guide-kicker">使用说明 / {chapter.title}</p><h2>{chapter.title}</h2><p className="guide-intro">{chapter.intro}</p>{chapter.sections.map((s,i)=><section key={i} className={s.subsections?'guide-module':undefined}><h3>{s.title}</h3><GuideContent section={s}/></section>)}</>:<div className="anomaly-empty"><h4>没有找到相关说明</h4><p>试试其他关键词，如“工时”“节点”“保存”。</p></div>}</article></div>
  </UtilityDialog>;
}


const EIC_BACKUP_NAMES=Object.fromEntries(Object.entries(BUSINESS_NAMES).filter(([key])=>key!=='ouData'));
function validateFullBackupData(data){
  const fail=()=>{throw Error('备份数据结构不完整或存在无效内容，未覆盖任何数据。');};
  const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
  if(!object(data)||Object.keys(data).length!==Object.keys(EIC_BACKUP_NAMES).length)fail();
  for(const key of Object.keys(EIC_BACKUP_NAMES)){
    if(key==='rates'||key==='matches'){if(!object(data[key]))fail();}
    else if(!Array.isArray(data[key])||data[key].some(row=>!object(row)))fail();
  }
  const inspect=(value)=>{
    if(!value||typeof value!=='object')return;
    for(const [key,v] of Object.entries(value)){
      if(['__proto__','prototype','constructor'].includes(key))fail();
      if(typeof v==='number'&&!Number.isFinite(v))fail();
      inspect(v);
    }
  };inspect(data);
  if(data.masterData.some(p=>typeof p.name!=='string'||typeof p.email!=='string'||typeof p.eic!=='string'||typeof p.level!=='string'||(p.fic!=null&&typeof p.fic!=='string')))fail();
  for(const level of Object.keys(DEFAULT_RATES))if(typeof data.rates[level]!=='number'||data.rates[level]<0)fail();
  const strings=(row,fields)=>fields.forEach(key=>{if(row[key]!=null&&typeof row[key]!=='string')fail();});
  const numbers=(row,fields)=>fields.forEach(key=>{if(row[key]!=null&&typeof row[key]!=='number')fail();});
  for(const key of ['eicData'])for(const row of data[key]){
    strings(row,['name','eic','level','week','engagementCode','engagementName']);numbers(row,['hrs']);
    if(typeof row.name!=='string'||typeof row.week!=='string'||typeof row.hrs!=='number')fail();
  }
  for(const row of data.budgetData){strings(row,['engagementCode','engagementName','benchmark','remark']);numbers(row,['budgetHrs','budgetSER']);}
  for(const row of data.timesheetData){strings(row,['employeeName','engagementCode','engagementName','level','date']);numbers(row,['hrs']);}
  for(const p of data.projects){
    strings(p,['name','code','fic','eic','section','teamFic']);
    if(!Array.isArray(p.nodes))fail();
    for(const n of p.nodes){if(!object(n))fail();strings(n,['name','week','date','note','attention','completed','actualDate']);if(typeof n.week!=='string'||typeof n.name!=='string')fail();}
  }
  for(const snapshot of data.taskLists){
    if(!Array.isArray(snapshot.tasks))fail();strings(snapshot,['periodStart','periodEnd']);
    for(const field of ['coveredSourceKeys','deletedSources'])if(snapshot[field]!=null&&!Array.isArray(snapshot[field]))fail();
    for(const task of snapshot.tasks){if(!object(task))fail();strings(task,['engagementName','projectCode','taskDescription','nodeName','startDate','dueDate']);if(!Array.isArray(task.assignees)||task.assignees.some(n=>typeof n!=='string'))fail();}
  }
  return data;
}
async function fullBackupDigest(payload){
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
async function createFullBackup(data){
  validateFullBackupData(data);
  const team=BookingTeams.metadata(data);BookingTeams.validate(team);
  const payload={format:'booking-system-full-backup',scope:'eic',schemaVersion:3,appVersion:'3.6',exportedAt:new Date().toISOString(),team:JSON.parse(JSON.stringify(team)),data};
  return {...payload,checksum:await fullBackupDigest(payload)};
}
async function parseFullBackup(text){
  let parsed;try{parsed=JSON.parse(text.replace(/^\uFEFF/,''));}catch(e){throw Error('无法读取 JSON 备份文件，未覆盖任何数据。');}
  if(!parsed||parsed.format!=='booking-system-full-backup'||![1,2,3].includes(parsed.schemaVersion)||parsed.scope!=='eic')throw Error('不是支持的全量备份文件，请选择主页导出的 JSON 备份。');
  const {checksum,...payload}=parsed;
  if(checksum!==await fullBackupDigest(payload))throw Error('备份校验失败，文件可能被修改或损坏，未覆盖任何数据。');
  if(parsed.schemaVersion===1&&!Object.prototype.hasOwnProperty.call(parsed.data,'masterData')){parsed.data.masterData=STAFF_MASTER.map(p=>({...p}));parsed.legacyMaster=true;}
  validateFullBackupData(parsed.data);if(parsed.schemaVersion===3){BookingTeams.validate(parsed.team);if(JSON.stringify(parsed.team)!==JSON.stringify(BookingTeams.metadata(parsed.data)))throw Error('文件身份与内部来源不一致');for(const source of parsed.team.sources)validateFullBackupData(source.data);if(parsed.team.identity.role==='FIC'&&parsed.team.sources.length)throw Error('FIC 文件不能携带多个团队来源');}return parsed;
}
function FullBackupControls(){
  const w=React.useContext(WorkspaceContext),input=useRef(null);
  const [pending,setPending]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const summarize=data=>Object.entries(EIC_BACKUP_NAMES).map(([key,label])=>({key,label,count:Array.isArray(data[key])?data[key].length:Object.keys(data[key]).length}));
  const exportBackup=async()=>{
    setBusy(true);setError('');setMessage('');
    try{
      if(!BookingTeams.metadata(w.data).identity){autoBackupEvents.dispatchEvent(new Event('setup'));return;}
      const backup=await createFullBackup(w.exportAll());
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=url;a.download=BookingTeams.fileName(backup);a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
      setMessage('已生成全部数据备份，请保管下载的 JSON 文件。');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const readBackup=async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;
    setPending(null);setBusy(true);setError('');setMessage('');
    try{const parsed=await parseFullBackup(await file.text());if(BookingTeams.metadata(w.data).identity?.role==='EIC'&&parsed.team?.identity.role==='FIC')throw Error('这是 FIC 文件，请使用“导入 FIC 数据”，避免覆盖整个工作台。');setPending(parsed);}catch(err){setError(err.message);}finally{setBusy(false);}
  };
  return <section className="glass-card full-backup-panel">
    <header className="backup-heading"><h2>数据备份与恢复</h2><p>保存完整的数据副本，或从已有备份恢复工作。</p></header>
    <TeamExchangePanel/>
    <AutoBackupPanel/>
    <div className="backup-manual-grid">
      <section className="backup-action-card"><h3>手动导出</h3><p>下载当前全部数据的 JSON 文件，适合迁移或单独留档。</p><button className="glass-btn" disabled={busy} onClick={exportBackup}>导出全部数据</button></section>
      <section className="backup-action-card"><h3>从备份恢复</h3><p>选择 JSON 备份，核对数据数量后确认覆盖。恢复后可以全局撤销。</p><button className="glass-btn" disabled={busy} onClick={()=>input.current.click()}>恢复全部数据</button><input ref={input} aria-label="选择全部数据备份" type="file" accept=".json,application/json" hidden onChange={readBackup}/></section>
    </div>
    <p className="backup-scope">备份范围：人员主数据、EIC 排班、预算、费率、实际工时、项目节点、已保存 Task 和人员匹配关系。<br/>不含 OU 数据、未保存草稿、页面筛选及过去的操作历史。自动备份文件也可通过“恢复全部数据”导入。</p>
    {busy&&<p role="status">正在处理备份…</p>}{error&&<p role="alert" className="tasklist-footer-error">{error}</p>}{message&&<p role="status">{message}</p>}
    {pending&&<UtilityDialog title="确认恢复全部数据" detail={'备份时间：'+new Date(pending.exportedAt).toLocaleString()+' · 来源版本 '+pending.appVersion} onClose={()=>setPending(null)}>
      {pending.legacyMaster&&<p>此旧版备份未包含人员主数据，恢复时保留当前主数据。</p>}
      <p>来源身份：{pending.team?.identity.role||'旧版未标识'} · {pending.team?.identity.name||'需在恢复后设置维护身份'}</p><p>以下八类数据将全部替换；备份中的空列表也会清空当前对应模块。确认后立即保存，当前操作历史中会新增一条可撤销的恢复记录。</p>
      <table className="resolution-table"><thead><tr><th>数据</th><th>当前数量</th><th>备份数量</th></tr></thead><tbody>{summarize(pending.data).map(item=><tr key={item.key}><td>{item.label}</td><td>{summarize(w.data).find(row=>row.key===item.key).count}</td><td>{item.count}</td></tr>)}</tbody></table>
      <p>项目内的节点、备注、编号和完成状态，以及 Task 分工与删除记录均随所属数据恢复。</p>
      <div className="modal-actions"><button className="glass-btn" onClick={()=>setPending(null)}>取消</button><button className="glass-btn primary-btn" onClick={()=>{try{w.restoreAll(pending.legacyMaster?{...pending.data,masterData:w.data.masterData}:pending.data);setPending(null);setError('');setMessage('全部数据已恢复并保存，可通过全局撤销恢复原数据。');}catch(e){setPending(null);setError(e.message);}}}>确认覆盖全部数据</button></div>
    </UtilityDialog>}
  </section>;
}

function applyMasterDataChange(data,rows,identity){
  const key=name=>String(name||'').toLowerCase().replace(/[.\s]/g,'');
  const targets=new Map(), deleted=new Set();
  const occupied=JSON.stringify(data)+JSON.stringify(rows);let dummyIndex=1;
  for(const old of data.masterData){
    const next=identity&&identity.before.email===old.email?identity.after:rows.find(row=>row.email.toLowerCase()===old.email.toLowerCase())||rows.find(row=>key(row.name)===key(old.name));
    if(next&&old.name!==next.name)targets.set(key(old.name),next);
    if(!next){
      let name;do{name='Dummy.'+old.level+'.'+String(dummyIndex++).padStart(3,'0');}while(occupied.includes(name));
      targets.set(key(old.name),{name,email:'',level:old.level,sourceName:old.name,unmatched:true});deleted.add(key(old.name));
    }
  }
  const rename=name=>targets.get(key(name))?.name||name;
  const renameList=value=>typeof value==='string'?value.split(/[,，;；]/).map(name=>rename(name.trim())).join(','):value;
  if(targets.size){
    for(const scope of ['eicData','ouData'])data[scope]=data[scope].map(row=>({...row,name:rename(row.name),eic:rename(row.eic),...(deleted.has(key(row.name))?{pending:true,email:''}: {})}));
    data.timesheetData=data.timesheetData.map(row=>({...row,employeeName:rename(row.employeeName)}));
    data.projects=data.projects.map(row=>({...row,fic:rename(row.fic),teamFic:rename(row.teamFic),eic:renameList(row.eic)}));
    data.taskLists=data.taskLists.map(snapshot=>({...snapshot,tasks:snapshot.tasks.map(task=>({...task,assignees:Array.from(new Set((task.assignees||[]).map(rename))),sourceManager:rename(task.sourceManager)})),
      ...(snapshot.sourceMeta?{sourceMeta:Object.fromEntries(Object.entries(snapshot.sourceMeta).map(([k,v])=>[k,{...v,sourceManager:rename(v.sourceManager)}]))}:{})}));
    data.matches=Object.fromEntries(Object.entries(data.matches).map(([k,v])=>{const next=targets.get(key(v.name));return [k,next?{...v,name:next.name,email:next.email}:v];}));
    for(const old of data.masterData){const next=targets.get(key(old.name));if(next){data.matches[old.name.toLowerCase()]={name:next.name,email:next.email};if(next.unmatched)data.matches[next.name.toLowerCase()]={...next};}}
  }
  data.masterData=rows.map(row=>({...row,eic:rename(row.eic),fic:rename(row.fic)}));
}

const MASTER_LEVELS=['Manager','Senior','Staff','Intern'];
const masterNameKey=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[.\s]/g,'');
function normalizeMasterRows(input,previous=[]){
  const errors=[],names=new Set(),emails=new Set();
  const rows=input.map((row,index)=>{
    const n=index+2,out={};
    for(const key of ['name','email','level','fic','eic']){
      const v=String(row[key]??'').normalize('NFKC').trim();
      if(!v)errors.push(`第 ${n} 行 ${key.toUpperCase()}：必填，不能为空。`);
      out[key]=v;
    }
    for(const key of ['name','fic','eic']){
      out[key]=BookingStaff.normalizeName(out[key]);
      if(out[key]&&!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(out[key]))errors.push(`第 ${n} 行 ${key.toUpperCase()}：请填英文姓名，以点号或空格分隔，例如 Example.Person 或 Example Person。`);
    }
    if(out.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))errors.push(`第 ${n} 行 Email：邮箱格式无效。`);
    out.level=MASTER_LEVELS.find(level=>level.toLowerCase()===out.level.toLowerCase())||out.level;
    if(out.level&&!MASTER_LEVELS.includes(out.level))errors.push(`第 ${n} 行 Level：只能选择 ${MASTER_LEVELS.join('、')}。`);
    const nk=masterNameKey(out.name),ek=out.email.toLowerCase();
    if(nk&&names.has(nk))errors.push(`第 ${n} 行 Name：与其他行重复（忽略空格、点号和大小写）。`);
    if(ek&&emails.has(ek))errors.push(`第 ${n} 行 Email：与其他行重复。`);
    names.add(nk);emails.add(ek);
    const old=previous.find(p=>p.email.toLowerCase()===ek);
    return {...old,...out,status:'active',chineseName:old?.chineseName||''};
  });
  rows.forEach(row=>{for(const key of ['fic','eic']){const match=rows.find(p=>masterNameKey(p.name)===masterNameKey(row[key]));if(match)row[key]=match.name;}});
  return {rows,errors};
}
function downloadMasterTemplate(records=[]){
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([['Name','Email','Level','FIC','EIC'],...records.map(p=>[p.name,p.email,p.level,p.fic||'',p.eic])]);
  ws['!cols']=[{wch:25},{wch:38},{wch:18},{wch:25},{wch:25}];
  XLSX.utils.book_append_sheet(wb,ws,'Master Data');
  const help=XLSX.utils.aoa_to_sheet([
    ['填写要求'],['五列全部必填；Name 和 Email 不可重复。'],['Name、FIC、EIC：英文姓名，点号或空格分隔，例如 Example.Person / Example Person；系统统一为点号。'],['Email：完整邮箱，例如 Example.Person@example.com。'],['FIC：必填备用字段，仅保存，不用于项目 FIC 回填或其他业务判断。'],['Level：在下拉框选择 Manager、Senior、Staff、Intern；不要自由填写其他级别。'],['导入为整份替换：文件内未包含的原人员将从主数据移除，已有业务记录保留，删除人员的引用转为待匹配 Dummy。'],['请在 Master Data 页填写；有错误时整批不导入，页面会列出行号、字段和原因。']]);
  help['!cols']=[{wch:110}];XLSX.utils.book_append_sheet(wb,help,'填写说明');
  const files=parseZipFiles(new Uint8Array(XLSX.write(wb,{type:'array',bookType:'xlsx',compression:false})));
  const enc=new TextEncoder();let xml=new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
  const validation='<dataValidations count="1"><dataValidation type="list" errorStyle="stop" allowBlank="0" showInputMessage="1" showErrorMessage="1" errorTitle="Level 无效" error="请从下拉列表选择 Manager、Senior、Staff 或 Intern。" promptTitle="必填：Level" prompt="请使用下拉选项。" sqref="C2:C1048576"><formula1>"Manager,Senior,Staff,Intern"</formula1></dataValidation></dataValidations>';
  xml=xml.replace('</sheetData>','</sheetData>'+validation);files['xl/worksheets/sheet1.xml']=enc.encode(xml);
  const url=URL.createObjectURL(new Blob([createZipFromFiles(files)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const a=document.createElement('a');a.href=url;a.download=records.length?'MasterData-当前人员.xlsx':'MasterData-导入模板.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function MasterDataPanel({onBack}){
  const w=React.useContext(WorkspaceContext),input=useRef(null);
  const [edit,setEdit]=useState(null),[pending,setPending]=useState(null),[errors,setErrors]=useState([]),[message,setMessage]=useState(''),[query,setQuery]=useState('');
  const records=w.data.masterData,filtered=records.filter(p=>[p.name,p.email,p.fic,p.eic].some(v=>String(v||'').toLowerCase().includes(query.toLowerCase())));
  const save=(rows,identity)=>{try{w.saveMaster(rows,identity);setErrors([]);setMessage('人员主数据已保存，其他页面的人员识别已同步。');return true;}catch(e){setErrors([e.message]);return false;}};
  const upload=async e=>{
    const file=e.target.files?.[0];e.target.value='';if(!file)return;setErrors([]);setPending(null);setMessage('');
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),sheet=wb.Sheets['Master Data']||wb.Sheets[wb.SheetNames[0]];
      const values=XLSX.utils.sheet_to_json(sheet,{header:1,defval:''});const header=(values[0]||[]).map(v=>String(v).normalize('NFKC').toLowerCase().replace(/[\s._-]/g,''));
      const fields=['name','email','level','fic','eic'];const missing=fields.filter(k=>header.filter(h=>h===k).length!==1);if(missing.length)throw Error('表头缺失或重复：'+missing.join('、')+'。请使用下载模板。');
      const raw=values.slice(1).map(row=>Object.fromEntries(fields.map(k=>[k,row[header.indexOf(k)]])));
      // Preserve physical row numbers while reporting errors; ignore completely empty rows.
      const filled=raw.map((row,i)=>({row,index:i+2})).filter(({row})=>Object.values(row).some(v=>String(v??'').trim()));
      if(!filled.length)throw Error('文件没有人员数据，未替换当前主数据。');
      const result=normalizeMasterRows(filled.map(x=>x.row),records);
      if(result.errors.length){setErrors(result.errors.map(text=>text.replace(/第 (\d+) 行/,(_,n)=>'第 '+filled[Number(n)-2].index+' 行')));return;}
      setPending(result.rows);
    }catch(e){setErrors([e.message||'无法读取文件，请使用 Excel 模板。']);}
  };
  const saveRow=()=>{
    const result=normalizeMasterRows([edit.row],records);if(result.errors.length){setErrors(result.errors.map(t=>t.replace('第 2 行 ','当前人员 ')));return;}
    const row=result.rows[0];if(records.some((p,i)=>i!==edit.index&&(masterNameKey(p.name)===masterNameKey(row.name)||p.email.toLowerCase()===row.email.toLowerCase()))){setErrors(['Name 或 Email 与现有人员重复，请修改后保存。']);return;}
    const next=records.slice();if(edit.index===-1)next.push(row);else next[edit.index]={...records[edit.index],...row,chineseName:records[edit.index].chineseName||''};
    if(save(next,edit.index>=0?{before:records[edit.index],after:next[edit.index]}:null))setEdit(null);
  };
  const beginEdit=(p,index)=>{setErrors([]);setMessage('');setEdit({index,row:{...p}});};
  const renderRow=(p,index,isEditing)=>{
    const fields=['name','email','level','fic','eic'];
    return <tr key={index===-1?'new':p.email} className={isEditing?'master-edit-row':''}>
      {fields.map(key=><td key={key}>{isEditing?(key==='level'?<select aria-label="Master Level" value={edit.row[key]||''} onChange={e=>setEdit({...edit,row:{...edit.row,[key]:e.target.value}})}><option value="">请选择</option>{MASTER_LEVELS.map(level=><option key={level}>{level}</option>)}</select>:<input aria-label={'Master '+key} placeholder={key==='email'?'name@example.com':key==='name'?'英文姓名':key.toUpperCase()} value={edit.row[key]||''} onChange={e=>setEdit({...edit,row:{...edit.row,[key]:e.target.value}})}/>):p[key]||'—'}</td>)}
      <td><div className="master-row-actions">{isEditing?<><button className="glass-btn primary-btn" onClick={saveRow}>保存</button><button className="glass-btn" onClick={()=>{setEdit(null);setErrors([]);}}>取消</button></>:<><button className="glass-btn" disabled={!!edit} aria-label={'编辑人员 '+p.email} onClick={()=>beginEdit(p,index)}>编辑</button><button className="glass-btn danger-btn" disabled={!!edit} aria-label={'删除人员 '+p.email} onClick={()=>{if(confirm('从主数据删除 '+p.name+'？已有引用转为待匹配 Dummy，业务记录保留，可全局撤销。'))save(records.filter(x=>x!==p));}}>删除</button></>}</div></td>
    </tr>;
  };
  return <div className="sub-app master-data-page"><WorkspaceHeader section="人员主数据" onBack={onBack}/><main className="master-workspace">
    <div className="master-page-heading"><PageHeading title="人员主数据" detail={'Master Data · '+records.length+' 人'}/></div>
    <div className="master-rules-row"><details className="master-rules"><summary>填写与导入规则 · 五列必填，姓名兼容点号或空格</summary><p>Name / FIC / EIC 填英文姓名，以点号或空格分隔（Example.Person / Example Person），保存为点号格式；Email 填完整邮箱；Level 只选 Manager、Senior、Staff、Intern。Name 和 Email 不可重复。FIC 来自 Senior Incharge，目前仅作备用字段。</p><p>导入整份替换，校验通过后确认。删除被引用人员会转为带级别和独立编号的 Dummy，在异常待办匹配后恢复关联。相同邮箱改名会同步业务姓名；Level / EIC 修改不重算历史工时。保存支持全局撤销。</p></details><span role="status" className="master-message">{message}</span></div>
    {!!errors.length&&<div role="alert" className="master-errors">{errors.map((e,i)=><div key={i}>{e}</div>)}</div>}
    <div className="master-toolbar"><input className="master-search" aria-label="搜索主数据人员" disabled={!!edit} placeholder="搜索姓名、邮箱、FIC 或 EIC" value={query} onChange={e=>setQuery(e.target.value)}/><div className="master-toolbar-actions"><button className="glass-btn" onClick={()=>downloadMasterTemplate()}>下载模板</button><button className="glass-btn" onClick={()=>downloadMasterTemplate(records)}>导出当前人员</button><button className="glass-btn" disabled={!!edit||!!pending} onClick={()=>input.current.click()}>导入替换</button><button className="glass-btn primary-btn" disabled={!!edit||!!pending} onClick={()=>{setQuery('');beginEdit({name:'',email:'',level:'',fic:'',eic:''},-1);document.querySelector('.master-table-scroll')?.scrollTo({top:0});}}>新增人员</button><input aria-label="导入 Master Data" ref={input} type="file" accept=".xlsx,.xls" hidden onChange={upload}/></div></div>
    {pending&&<div className="master-import-confirm"><span>文件校验通过：将以 {pending.length} 人替换当前 {records.length} 人。请核对下方预览。</span><button className="glass-btn" onClick={()=>setPending(null)}>取消替换</button><button className="glass-btn primary-btn" onClick={()=>{if(save(pending))setPending(null);}}>确认替换主数据</button></div>}
    <div className="master-table-scroll"><table className="master-table"><colgroup><col style={{width:'18%'}}/><col style={{width:'27%'}}/><col style={{width:'12%'}}/><col style={{width:'16%'}}/><col style={{width:'16%'}}/><col style={{width:150}}/></colgroup><thead><tr>{['Name','Email','Level','FIC','EIC',...(pending?[]:['操作'])].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>
      {!pending&&!records.length&&!edit&&<tr><td colSpan={6}>尚未配置人员主数据。请下载模板填写后导入，或点击“新增人员”。</td></tr>}
      {pending?pending.map(row=><tr key={row.email}>{['name','email','level','fic','eic'].map(k=><td key={k}>{row[k]}</td>)}</tr>):<>{edit?.index===-1&&renderRow(edit.row,-1,true)}{filtered.map(p=>renderRow(p,records.indexOf(p),edit?.index===records.indexOf(p)))}</>}
    </tbody></table></div>
  </main></div>;

}


const autoBackupEvents=new EventTarget();
let autoBackupService=null;
function useAutoBackupState(){
  const [state,setState]=useState(()=>autoBackupService?.getState()||{});
  useEffect(()=>{const update=()=>setState(autoBackupService?.getState()||{});autoBackupEvents.addEventListener('change',update);update();return()=>autoBackupEvents.removeEventListener('change',update);},[]);
  return state;
}
function AutoBackupManager(){
  const w=React.useContext(WorkspaceContext),latest=useRef(w);latest.current=w;
  const [prompt,setPrompt]=useState(false),[step,setStep]=useState('identity'),state=useAutoBackupState();
  const [role,setRole]=useState('FIC'),[name,setName]=useState(''),[eic,setEic]=useState(''),[error,setError]=useState(''),[ack,setAck]=useState(false);
  const openSetup=()=>{const id=BookingTeams.metadata(latest.current.data).identity;setRole(id?.role||'FIC');setName(id?.name||'');setEic(id?.eic||'');setStep(id?'folder':'identity');setError('');setAck(false);setPrompt(true);};
  const saveIdentity=()=>{try{const current=latest.current,meta=BookingTeams.metadata(current.data),id=meta.identity,n=normalizeName(name),manager=role==='EIC'?n:normalizeName(eic);if(!n||!manager||!BookingStaff.isBookingName(n)||!BookingStaff.isBookingName(manager))throw Error('请填写维护人姓名和所属 EIC，姓名可用点号或空格分隔。');const changed=!id||id.name!==n||id.role!==role||id.eic!==manager;if(meta.sources.length&&changed)throw Error('已有汇总来源，不能在此更改维护身份。');if(changed&&(id||['eicData','budgetData','projects','timesheetData','taskLists'].some(k=>current.data[k].length))&&!ack)throw Error('请确认当前数据确实由该身份维护。');if(changed)current.commit('设置维护身份',d=>{d.matches[BookingTeams.KEY]={...meta,identity:{id:id?.id||crypto.randomUUID(),role,name:n,eic:manager}};});setError('');setStep('folder');}catch(e){setError(e.message);}};
  useEffect(()=>{
    let alive=true;
    const service=BookingAutoBackup.create({getSnapshot:()=>{
      // Read the latest committed snapshot, including saves from another open tab.
      const saved=JSON.parse(localStorage.getItem(BookingWorkspace.KEY)||'null');
      if(saved?.data){const {ouData,...data}=saved.data;return data;}
      return latest.current.exportAll();
    },encode:createFullBackup,onChange:()=>autoBackupEvents.dispatchEvent(new Event('change'))});
    autoBackupService=service;
    service.load().then(s=>{if(!alive)return;if(!BookingTeams.metadata(latest.current.data).identity||!s.folder||s.permission!=='granted')openSetup();else service.run();});
    autoBackupEvents.addEventListener('setup',openSetup);
    const tick=()=>{if(BookingTeams.metadata(latest.current.data).identity)service.run();};const timer=setInterval(tick,60000);
    const visible=()=>{if(document.visibilityState==='visible')tick();};
    document.addEventListener('visibilitychange',visible);window.addEventListener('focus',tick);
    return()=>{alive=false;clearInterval(timer);autoBackupEvents.removeEventListener('setup',openSetup);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',tick);};
  },[]);
  if(!prompt)return null;
  return <UtilityDialog title="维护身份与自动备份" detail="先确认维护身份，再选择自动备份文件夹。设置会保留，无需每次重复。" onClose={()=>setPrompt(false)}>
    <div className="setup-flow">
      <ol className="setup-steps" aria-label="设置步骤"><li className={step==='identity'?'active':'done'}><span>1</span>维护身份</li><li className={step==='folder'?'active':''}><span>2</span>备份文件夹</li></ol>
      {step==='identity'?<>
        <p className="setup-description">此身份会标在导出文件和自动备份中，供经理识别数据来源。</p>
        <div className="setup-role-options" role="group" aria-label="维护角色">{['FIC','EIC'].map(r=><button key={r} className={'glass-btn '+(role===r?'selected':'')} aria-pressed={role===r} onClick={()=>setRole(r)}><strong>{r}</strong><span>{r==='FIC'?'维护并提交自己的数据':'收集、汇总多个 FIC 的数据'}</span></button>)}</div>
        <div className="setup-identity-fields"><label>维护人姓名<input aria-label="设置维护人姓名" placeholder="例如 Example.Person" value={name} onChange={e=>setName(e.target.value)}/></label>{role==='FIC'&&<label>所属 EIC<input aria-label="设置所属 EIC" placeholder="填写经理姓名" value={eic} onChange={e=>setEic(e.target.value)}/></label>}</div>
        <p className="utility-note">姓名可用点号或空格分隔；FIC 身份不会限制共享人员的排班。</p>
        {(BookingTeams.metadata(w.data).identity||['eicData','budgetData','projects','timesheetData','taskLists'].some(k=>w.data[k].length))&&<label className="setup-ack"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>更改身份时，我确认当前数据确实由该身份维护。</label>}
        {error&&<p role="alert" className="tasklist-footer-error">{error}</p>}
        <div className="modal-actions"><button className="glass-btn" onClick={()=>setPrompt(false)}>暂不设置</button><button className="glass-btn primary-btn" onClick={saveIdentity}>下一步：备份文件夹</button></div>
      </>:<>
        <div className="setup-identity-summary"><span>维护身份</span><strong>{BookingTeams.metadata(w.data).identity?.role} · {BookingTeams.metadata(w.data).identity?.name}</strong><button className="glass-btn" onClick={()=>{const id=BookingTeams.metadata(w.data).identity;setRole(id.role);setName(id.name);setEic(id.eic);setAck(false);setStep('identity');}}>返回修改</button></div>
        <p>{state.folder?'已记住文件夹：'+state.folder+'。可继续使用，不必重新选择。':'选择存放自动备份的文件夹，完成后立即保存第一份备份。'}</p>
        <p className="utility-note">网页打开期间每两小时备份一次，最多保留五份。关闭网页期间不备份；电脑休眠后恢复运行时补做一次。</p>
        {!state.supported&&<p role="alert">当前浏览器不支持直接写入文件夹，请使用桌面版 Chrome 或 Edge。已保存的维护身份仍可用于手动导出。</p>}
        {state.error&&<p role="alert" className="tasklist-footer-error">{state.error}</p>}
        <div className="modal-actions"><button className="glass-btn" onClick={()=>setPrompt(false)}>暂不设置</button>{state.folder&&<button className="glass-btn" disabled={state.busy||!state.supported} onClick={async()=>{const ok=await autoBackupService.choose();if(ok&&!autoBackupService.getState().error)setPrompt(false);}}>更换文件夹</button>}<button className="glass-btn primary-btn" disabled={!state.ready||!state.supported||state.busy} onClick={async()=>{const ok=!state.folder?await autoBackupService.choose():state.permission!=='granted'?await autoBackupService.authorize():await autoBackupService.run(true);if(ok&&!autoBackupService.getState().error)setPrompt(false);}}>{state.busy?'正在保存…':!state.folder?'选择文件夹并启用':state.permission!=='granted'?'授权文件夹并启用':'完成设置并备份'}</button></div>
      </>}
    </div>
  </UtilityDialog>;
}
function AutoBackupPanel(){
  const w=React.useContext(WorkspaceContext),identity=BookingTeams.metadata(w.data).identity;
  const state=useAutoBackupState(),format=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未备份';
  return <section className="backup-auto-card"><div className="backup-auto-heading"><h3>自动备份</h3><span className="backup-status">{!identity?'请先设置维护身份':!state.ready?'正在读取设置':!state.supported?'浏览器不支持':state.busy?'正在备份':state.error?'备份需要处理':!state.folder?'尚未设置':state.permission!=='granted'?'需要授权':'已启用'}</span></div>
    <p>每 2 小时自动保存一次 · 最多保留 5 份，成功写入后移除最早的一份。</p>
    <dl className="backup-facts"><div><dt>存放文件夹</dt><dd>{state.folder||'尚未选择'}</dd></div><div><dt>最近成功备份</dt><dd>{format(state.lastSuccess)}</dd></div><div><dt>下次备份</dt><dd>{state.folder&&state.permission==='granted'&&state.lastSuccess?format(state.lastSuccess+BookingAutoBackup.INTERVAL):'启用后自动安排'}</dd></div></dl>
    <div className="full-backup-actions"><button className="glass-btn" disabled={!!identity&&(!state.ready||!state.supported||state.busy)} onClick={()=>{if(!identity)autoBackupEvents.dispatchEvent(new Event('setup'));else autoBackupService.choose();}}>{!identity?'设置身份与备份':state.folder?'更改备份文件夹':'选择备份文件夹'}</button>{identity&&state.folder&&state.permission!=='granted'&&<button className="glass-btn primary-btn" disabled={state.busy} onClick={()=>autoBackupService.authorize()}>授权原文件夹</button>}<button className="glass-btn" disabled={!identity||!state.folder||state.permission!=='granted'||state.busy||!state.supported} onClick={()=>autoBackupService.run(true)}>立即备份一次</button></div>
    {state.error&&<p className="tasklist-footer-error" role="alert">{state.error}</p>}
    <p className="backup-footnote">仅在网页运行且文件夹获授权时备份。文件夹设置与版本号无关；沿用同一浏览器、用户及打开位置即可复用。更换浏览器、清除站点数据或改变打开位置可能需要重新选择。浏览器仅允许显示文件夹名称，不提供完整路径。</p>
    {!state.supported&&state.ready&&<p role="alert">自动备份需要支持文件夹读写的桌面版 Chrome 或 Edge，当前可使用手动导出。</p>}
  </section>;
}

function TeamExchangePanel(){
 const w=React.useContext(WorkspaceContext),meta=BookingTeams.metadata(w.data),id=meta.identity;
 const [role,setRole]=useState(id?.role||'FIC'),[name,setName]=useState(id?.name||''),[eic,setEic]=useState(id?.eic||''),[error,setError]=useState(''),[queue,setQueue]=useState([]),[preview,setPreview]=useState(null),[target,setTarget]=useState(''),[old,setOld]=useState(false),[ack,setAck]=useState(false),[notice,setNotice]=useState(''),[legacyName,setLegacyName]=useState('');const input=useRef(null);
 const identityKey=JSON.stringify(id||null),previousIdentity=useRef(identityKey);useEffect(()=>{if(previousIdentity.current!==identityKey){previousIdentity.current=identityKey;setRole(id?.role||'FIC');setName(id?.name||'');setEic(id?.eic||'');}},[identityKey]);
 const attempt=fn=>{try{fn();setError('');}catch(e){setError(e.message);}};
 const saveIdentity=()=>attempt(()=>{const n=normalizeName(name),manager=role==='EIC'?n:normalizeName(eic);if(!n||!manager||!BookingStaff.isBookingName(n)||!BookingStaff.isBookingName(manager))throw Error('请填写有效的维护人姓名和所属 EIC');if(meta.sources.length&&(role!==id.role||n!==id.name))throw Error('已有汇总来源，不能变更维护身份。请使用独立工作台维护其他身份。');if((id||['eicData','budgetData','projects','timesheetData','taskLists'].some(k=>w.data[k].length))&&!window.confirm('确认维护身份？当前工作台数据将由该身份维护并导出；请勿将他人的整份数据冒作本人的提交。'))return;w.commit('设置维护身份',d=>{d.matches[BookingTeams.KEY]={...meta,identity:{id:id?.id||crypto.randomUUID(),role,name:n,eic:manager}};});setNotice('维护身份已保存；自动备份和导出将使用此身份。');});
 const read=async e=>{const files=[...e.target.files];e.target.value='';try{const values=[];for(const f of files)values.push(await parseFullBackup(await f.text()));if(values.some(b=>b.team?.identity.role==='EIC'))throw Error('EIC 文件应通过“恢复全部数据”整份恢复');setQueue(values);setPreview(null);setTarget('');setOld(false);setAck(false);setError('');}catch(err){setError(err.message);}};
 const build=()=>attempt(()=>{const p=BookingTeams.plan(w.data,queue[0],target,old,ack);const oldMaster=new Map(w.data.masterData.map(p=>[p.email.toLowerCase(),p]));for(const person of p.entry.data.masterData){const prior=oldMaster.get(person.email.toLowerCase());if(prior&&JSON.stringify([prior.name,prior.level,prior.fic,prior.eic])!==JSON.stringify([person.name,person.level,person.fic,person.eic])&&!p.conflicts.people.some(([email])=>email===person.email.toLowerCase()))p.conflicts.people.push([person.email.toLowerCase(),[{source:'current',person:prior},{source:p.entry.id,person}]]);}p.meta.owners={...p.meta.owners};p.meta.people={...p.meta.people};for(const [code]of p.conflicts.projects)delete p.meta.owners[code];for(const [email]of p.conflicts.people)delete p.meta.people[email];if(!p.meta.rateSource)p.meta.rateSource=p.entry.id;setPreview(p);});
 const update=(kind,key,value)=>setPreview(p=>({...p,meta:{...p.meta,[kind]:{...p.meta[kind],[key]:value}}}));
 const apply=()=>attempt(()=>{for(const [email,rows]of preview.conflicts.people)if(!preview.meta.people[email])throw Error('请确认人员主数据差异：'+email);const next=BookingTeams.materialize(w.data,preview.meta);w.restoreAll(next);setNotice('已更新 '+preview.entry.name+'；其他来源保留。可通过全局撤销恢复。');setQueue(q=>q.slice(1));setPreview(null);setTarget('');setOld(false);setAck(false);});
 return <section className="backup-auto-card team-exchange"><h3>维护身份与 FIC 数据汇总</h3><p>数据按提交来源更新；排班按实际人员汇总，借用人员不改变来源。{meta.sources.length>0&&'当前汇总数据只读，请在源 FIC 工作台修正后重新提交。'}</p>
 <div className="team-form"><label>身份<select value={role} onChange={e=>setRole(e.target.value)}><option>FIC</option><option>EIC</option></select></label><label>维护人姓名<input aria-label="维护人姓名" value={name} onChange={e=>setName(e.target.value)}/></label>{role==='FIC'&&<label>所属 EIC<input aria-label="所属 EIC" value={eic} onChange={e=>setEic(e.target.value)}/></label>}<button className="glass-btn" onClick={saveIdentity}>保存维护身份</button></div>
 <div className="team-identity-meta">{id&&<span title={'来源编号：'+id.id}>当前身份 <strong>{id.role} · {id.name}</strong><span className="team-identity-manager">所属 EIC：{id.eic}</span></span>}{notice&&<span role="status" className="team-save-status">{notice}</span>}</div>
 {id?.role==='EIC'&&<section className="team-source-section" aria-label="FIC 来源列表">
 <header className="team-source-heading"><div><h4>FIC 数据来源 <span>{meta.sources.length}</span></h4><p>每份文件只更新对应 FIC；其他来源的数据保留。</p></div><button className="glass-btn primary-btn" onClick={()=>input.current.click()}>导入 FIC 数据</button><input ref={input} type="file" multiple accept=".json" hidden aria-label="选择 FIC 数据" onChange={read}/></header>
 <div className="team-source-table-wrap"><table className="team-source-table"><thead><tr><th scope="col">FIC 来源</th><th scope="col">最近导出</th><th scope="col">最近导入</th><th scope="col">状态</th></tr></thead><tbody>{meta.sources.length?meta.sources.map(s=><tr key={s.id}><td><strong title={'来源编号：'+s.id}>{s.name}</strong><span className="team-source-id" title={s.id}>来源编号 {s.id.length>14?s.id.slice(0,8)+'…':s.id}</span></td><td>{s.exportedAt?<time>{new Date(s.exportedAt).toLocaleString('zh-CN',{hour12:false})}</time>:<span className="team-source-muted">尚未收到文件</span>}</td><td>{s.importedAt?<time>{new Date(s.importedAt).toLocaleString('zh-CN',{hour12:false})}</time>:<span className="team-source-muted">—</span>}</td><td><span className={'team-source-status '+(s.importedAt?'received':'waiting')}>{s.importedAt?'已导入':s.exportedAt?'本地保留':'待接收'}</span></td></tr>):<tr><td colSpan={4}><div className="team-source-empty"><UIIcon name="people"/><strong>尚未导入 FIC 数据</strong><p>收到文件后，点击右上方“导入 FIC 数据”。<br/>可一次选择多份文件，逐份核对来源后确认。</p></div></td></tr>}</tbody></table></div>
 <p className="team-source-help">每次确认都可全局撤销；EIC 完整备份会保留全部来源及其更新记录。</p>
 <details className="team-legacy"><summary><span>接收旧版备份</span><small>适用于 3.5 等未带身份标识的 JSON</small></summary><div className="team-legacy-body"><p>先登记旧备份所属的 FIC，再通过上方“导入 FIC 数据”选择文件并指定此来源。3.6 文件已带身份标识，可直接导入，无需登记。</p><p className="team-legacy-note">登记只建立接收来源，不会导入数据，也不会新增 Master Data 人员。</p><div className="team-legacy-form"><label>备份所属 FIC<input aria-label="旧版 FIC 姓名" placeholder="例如 Example.Person" value={legacyName} onChange={e=>setLegacyName(e.target.value)}/></label><button className="glass-btn" disabled={!legacyName.trim()} onClick={()=>attempt(()=>{const fic=normalizeName(legacyName);if(!BookingStaff.isBookingName(fic))throw Error('姓名无效');if(meta.sources.some(s=>s.name===fic))throw Error('该来源已经存在');w.commit('登记旧版来源',d=>{const m=JSON.parse(JSON.stringify(meta));const empty=BookingTeams.clean(d);for(const k of ['masterData','eicData','budgetData','projects','timesheetData','taskLists'])empty[k]=[];empty.matches={};m.sources.push({id:crypto.randomUUID(),name:fic,eic:id.name,data:empty});d.matches[BookingTeams.KEY]=m;});setLegacyName('');setNotice('已登记 '+fic+'，导入旧版文件时请选择此来源。');})}>登记接收来源</button></div></div></details>
 </section>}
 {error&&<p role="alert" className="tasklist-footer-error">{error}</p>}
 {!!queue.length&&<UtilityDialog title="确认 FIC 数据来源" detail={'待处理 '+queue.length+' 份 · '+(queue[0].team?.identity.name||'旧版未标识')+' · '+new Date(queue[0].exportedAt).toLocaleString('zh-CN')} onClose={()=>{setQueue([]);setPreview(null);}}>
 {!preview?<><label>覆盖来源<select aria-label="覆盖来源" value={target} onChange={e=>setTarget(e.target.value)}><option value="">按文件编号自动识别</option>{meta.sources.map(s=><option key={s.id} value={s.id}>{s.name} · {s.id}</option>)}</select></label><label><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>确认负责人或来源编号调整，文件确实属于所选来源</label><label><input type="checkbox" checked={old} onChange={e=>setOld(e.target.checked)}/>允许导入旧版或重复文件（替换，不追加）</label><button className="glass-btn" onClick={build}>预览更新范围</button></>:<>
 <p>将{preview.previous?'替换':'新增'} {preview.entry.name} 的完整快照。文件中删除的记录同步移除，其他 FIC 来源不受影响。</p><table className="resolution-table"><thead><tr><th>数据</th><th>原来源数量</th><th>新数量</th></tr></thead><tbody>{Object.entries(EIC_BACKUP_NAMES).map(([k,label])=><tr key={k}><td>{label}</td><td>{Array.isArray(preview.previous?.data[k])?preview.previous.data[k].length:'—'}</td><td>{Array.isArray(preview.entry.data[k])?preview.entry.data[k].length:'—'}</td></tr>)}</tbody></table>
 <details><summary>查看本次完整记录（人员、项目、日期及工时）</summary><pre style={{maxHeight:180,overflow:'auto',whiteSpace:'pre-wrap'}}>{JSON.stringify(preview.entry.data,null,2)}</pre></details>
 {preview.conflicts.projects.map(([code,ids])=><label key={code}>共享项目 {code}：选择预算、实际工时、节点、Task 资料来源（排班仍全部汇总）<select aria-label={'项目来源 '+code} value={preview.meta.owners[code]||''} onChange={e=>update('owners',code,e.target.value)}><option value="">请选择</option>{ids.map(i=><option key={i} value={i}>{preview.meta.sources.find(s=>s.id===i).name}</option>)}</select></label>)}
 {preview.conflicts.people.map(([email,rows])=><label key={email}>人员差异 {email}<select aria-label={'人员来源 '+email} value={preview.meta.people[email]||''} onChange={e=>update('people',email,e.target.value)}><option value="">请选择</option>{rows.map(r=><option key={r.source} value={r.source}>{r.source==='current'?'经理现有名单':preview.meta.sources.find(s=>s.id===r.source)?.name}：{r.person.name} / {r.person.level} / FIC {r.person.fic} / EIC {r.person.eic}</option>)}</select></label>)}
 <label>汇总费率来源<select value={preview.meta.rateSource} onChange={e=>setPreview(p=>({...p,meta:{...p.meta,rateSource:e.target.value}}))}>{preview.meta.sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button className="glass-btn primary-btn" onClick={apply}>确认更新 {preview.entry.name} 的数据</button></>}{error&&<p role="alert">{error}</p>}
 </UtilityDialog>}
 </section>;
}
