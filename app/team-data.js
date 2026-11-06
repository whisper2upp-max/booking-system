(function(root){
const KEY='teamWorkspaceV1',clone=x=>JSON.parse(JSON.stringify(x)),norm=x=>String(x||'').toLowerCase().replace(/[.\s]/g,'');
const metadata=d=>d.matches?.[KEY]||{identity:null,sources:[],owners:{},people:{},rateSource:''};
function clean(data){const d=clone(data);delete d.matches[KEY];delete d.ouData;return d;}
function validate(m){if(!m||!m.identity||!['FIC','EIC'].includes(m.identity.role)||![m.identity.id,m.identity.name,m.identity.eic].every(v=>typeof v==='string'&&v.trim()&&v.length<=256)||!Array.isArray(m.sources))throw Error('维护身份或来源信息不完整');const ids=new Set();for(const s of m.sources){if(!s.id||ids.has(s.id)||!s.data||s.data.matches?.[KEY])throw Error('来源数据无效或重复');ids.add(s.id);}return m;}
function sourceCodes(s){return new Set([...s.data.projects.map(x=>x.code),...s.data.budgetData.map(x=>x.engagementCode),...s.data.timesheetData.map(x=>x.engagementCode),...s.data.taskLists.flatMap(l=>l.tasks.map(t=>t.projectCode))].filter(Boolean));}
function conflicts(sources){const projects={},people={};for(const s of sources){for(const code of sourceCodes(s))(projects[code]??=[]).push(s.id);for(const p of s.data.masterData)(people[p.email.toLowerCase()]??=[]).push({source:s.id,person:p});}return {projects:Object.entries(projects).filter(([,ids])=>ids.length>1),people:Object.entries(people).filter(([,rows])=>new Set(rows.map(r=>JSON.stringify([r.person.name,r.person.level,r.person.fic,r.person.eic]))).size>1)};}
function plan(current,backup,targetId,allowOld=false,ack=false){const m=clone(metadata(current));if(m.identity?.role!=='EIC')throw Error('请先设置 EIC 维护身份');let identity=backup.team?.identity;if(identity?.role==='EIC')throw Error('EIC 文件只能整份恢复，不能作为 FIC 来源导入');if(!identity&&!targetId)throw Error('旧版文件没有来源标识，请指定 FIC 来源');
const sourceId=targetId||identity.id;let previous=m.sources.find(s=>s.id===sourceId);if(!previous&&targetId&&!identity)throw Error('请先在来源列表中创建旧版文件的 FIC 来源');
if(identity&&norm(identity.eic)!==norm(m.identity.name))throw Error('文件所属 EIC 与当前经理不一致');
if(identity&&!targetId&&m.sources.some(s=>s.id!==sourceId&&norm(s.name)===norm(identity.name)))throw Error('相同 FIC 姓名对应不同来源编号，请明确指定已有来源后重新预览');
if(previous&&((identity&&norm(previous.name)!==norm(identity.name))||(identity&&targetId&&identity.id!==targetId))&&!ack)throw Error('负责人或来源编号不同，请勾选确认来源调整');
if(previous?.exportedAt&&Date.parse(backup.exportedAt)<=Date.parse(previous.exportedAt)&&!allowOld)throw Error('文件时间不晚于已导入版本，请确认允许导入旧版或重复文件');
if(!m.sources.some(s=>s.exportedAt)&&['eicData','budgetData','projects','timesheetData','taskLists'].some(k=>current[k].length))m.sources.push({id:'local-'+m.identity.id,name:'经理原有数据',eic:m.identity.name,exportedAt:new Date().toISOString(),data:clean(current)});
const entry={id:sourceId,name:identity?.name||previous.name,eic:identity?.eic||previous.eic,exportedAt:backup.exportedAt,importedAt:new Date().toISOString(),data:clean(backup.data)};
m.sources=m.sources.filter(s=>s.id!==sourceId).concat(entry);
return {meta:m,entry,previous,conflicts:conflicts(m.sources)};}
function materialize(current,m){
validate(m);for(const [code,owner]of Object.entries(m.owners||{}))if(!m.sources.some(s=>s.id===owner&&sourceCodes(s).has(code)))delete m.owners[code];for(const [email,owner]of Object.entries(m.people||{}))if(owner!=='current'&&!m.sources.some(s=>s.id===owner&&s.data.masterData.some(p=>p.email.toLowerCase()===email)))delete m.people[email];const c=conflicts(m.sources);for(const [code,ids]of c.projects)if(!ids.includes(m.owners?.[code]))throw Error('请选择共享项目 '+code+' 的项目资料来源');for(const [email,rows]of c.people)if(!rows.some(r=>r.source===m.people?.[email]))throw Error('请选择人员 '+email+' 的主数据来源');if(!m.sources.some(s=>s.id===m.rateSource))throw Error('请选择汇总工作台使用的费率来源');
const out=clean(current);for(const k of ['eicData','budgetData','timesheetData','projects','taskLists'])out[k]=[];
const masters=new Map(current.masterData.map(p=>[p.email.toLowerCase(),p]));
for(const s of m.sources)for(const p of s.data.masterData){const key=p.email.toLowerCase();if(!masters.has(key)||!m.people[key]||m.people[key]===s.id)masters.set(key,clone(p));}
const nameKeys=new Map();for(const p of masters.values()){const n=norm(p.name);if(nameKeys.has(n)&&nameKeys.get(n)!==p.email.toLowerCase())throw Error('相同姓名对应不同邮箱：'+p.name+'，请先核实人员身份');nameKeys.set(n,p.email.toLowerCase());}out.masterData=[...masters.values()];
for(const s of m.sources){const names=new Map(s.data.masterData.map(p=>[norm(p.name),masters.get(p.email.toLowerCase()).name]));const rename=n=>names.get(norm(n))||n;const owns=code=>!m.owners[code]||!m.sources.some(x=>x.id===m.owners[code])||m.owners[code]===s.id;const tag=row=>({...clone(row),sourceFicId:s.id,sourceFicName:s.name});
out.eicData.push(...s.data.eicData.map(r=>({...tag(r),name:rename(r.name),eic:rename(r.eic)})));
out.budgetData.push(...s.data.budgetData.filter(r=>owns(r.engagementCode)).map(r=>({...tag(r),id:s.id+':'+r.id})));
out.timesheetData.push(...s.data.timesheetData.filter(r=>owns(r.engagementCode)).map(r=>({...tag(r),employeeName:rename(r.employeeName)})));
out.projects.push(...s.data.projects.filter(r=>owns(r.code)).map(r=>({...tag(r),id:s.id+':'+r.id,fic:rename(r.fic),teamFic:rename(r.teamFic),nodes:r.nodes.map(n=>({...n,id:s.id+':'+n.id}))})));
const ns=x=>x?s.id+':'+x:x,sk=x=>String(x||'').split('::').map((v,i)=>i===0&&v==='manual'?v:ns(v)).join('::');
out.taskLists.push(...s.data.taskLists.map(l=>({...tag(l),id:ns(l.id),coveredSourceKeys:(l.coveredSourceKeys||[]).map(sk),deletedSources:(l.deletedSources||[]).map(x=>typeof x==='string'?sk(x):{...x,sourceKey:sk(x.sourceKey)}),sourceMeta:Object.fromEntries(Object.entries(l.sourceMeta||{}).map(([k,v])=>[sk(k),{...v,projectId:ns(v.projectId),nodeId:ns(v.nodeId)}])),tasks:l.tasks.filter(t=>owns(t.projectCode)).map(t=>({...t,id:ns(t.id),projectId:ns(t.projectId),nodeId:ns(t.nodeId),sourceKey:sk(t.sourceKey),assignees:t.assignees.map(rename)}))})).filter(l=>l.tasks.length));
}for(const row of out.eicData)if(row.engagementCode&&!out.projects.some(p=>p.code===row.engagementCode))out.projects.push({id:'derived:'+row.engagementCode,code:row.engagementCode,name:row.engagementName||row.engagementCode,fic:'',eic:row.eic,teamFic:'',nodes:[]});out.rates=clone(m.sources.find(s=>s.id===m.rateSource).data.rates);out.matches={...out.matches,[KEY]:clone(m)};return out;
}
function fileName(backup,auto=false){const i=backup.team?.identity;const safe=x=>String(x).replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');return 'Booking-'+(i?i.role+'-'+safe(i.name):'未设置身份')+(auto?'-自动备份':'')+'-'+(()=>{const d=new Date(backup.exportedAt),p=n=>String(n).padStart(2,'0');return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());})()+'.json';}
root.BookingTeams={KEY,metadata,clean,validate,plan,conflicts,materialize,fileName};if(typeof module!=='undefined')module.exports=root.BookingTeams;
})(typeof window==='undefined'?globalThis:window);
