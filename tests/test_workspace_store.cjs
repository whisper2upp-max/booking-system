const assert=require('assert');
const {create,KEY,KEYS,JOURNAL,changes,apply}=require('../app/workspace-store.js');
const defaults={masterData:[],eicData:[],ouData:[],budgetData:[],rates:{Staff:683},timesheetData:[],projects:[],taskLists:[],matches:{}};
const clone=x=>JSON.parse(JSON.stringify(x));
function storage(){
  const map=new Map();return {map,fail:null,getItem:k=>map.has(k)?map.get(k):null,setItem(k,v){if(this.fail?.(k,v))throw Error('quota');map.set(k,String(v));},removeItem(k){map.delete(k);}};
}
function make(s,extra={}){return create(s,{defaults,...extra});}
const s=storage();let store=make(s);
store.commit('seed',d=>{d.eicData=[{name:'Old.Name',hrs:20}];d.ouData=[{name:'Old.Name',hrs:10}];d.projects=[{fic:'Old.Name'}];d.taskLists=[{assignees:['Old.Name']}];});
const before=clone(store.getState());
store.commit('map person',d=>{d.eicData[0].name='New.Name';d.ouData[0].name='New.Name';d.projects[0].fic='New.Name';d.taskLists[0].assignees=['New.Name'];d.matches={'old.name':{name:'New.Name'}};});
const matched=clone(store.getState());
assert.equal(store.getHistory().past.length,2);
store.undo();assert.deepStrictEqual(store.getState(),before);
store.redo();assert.deepStrictEqual(store.getState(),matched);
store=make(s);assert.deepStrictEqual(store.getState(),matched);store.undo();assert.deepStrictEqual(store.getState(),before);
const redoCount=store.getHistory().future.length;
store.commit('no-op',()=>{});assert.equal(store.getHistory().future.length,redoCount);
store.commit('new branch',d=>{d.rates.Staff=700;});assert.equal(store.getHistory().future.length,0);
const saved=clone(store.getState()),savedHistory=clone(store.getHistory()),raw=new Map(s.map);
s.fail=(k)=>k===KEY;
assert.throws(()=>store.commit('fail',d=>{d.eicData=[];d.taskLists=[];d.matches={};}),/未提交/);
assert.deepStrictEqual(store.getState(),saved);assert.deepStrictEqual(store.getHistory(),savedHistory);assert.deepStrictEqual(s.map,raw);
s.fail=(k)=>k===KEYS.taskLists;
assert.throws(()=>store.commit('fail mirror',d=>{d.eicData=[];d.taskLists=[];}),/未提交/);
assert.deepStrictEqual(s.map,raw);assert.deepStrictEqual(store.getState(),saved);
s.fail=null;
store.commit('clear',d=>Object.assign(d,clone(defaults)));store.undo();assert.deepStrictEqual(store.getState(),saved);store.redo();assert.deepStrictEqual(store.getState(),defaults);
// Committed state wins after interruption, including legacy helpers' mirrors.
s.map.set(KEYS.eicData,'[{"name":"uncommitted"}]');
assert.throws(()=>make(s),/保留两份内容/);assert(s.getItem(KEYS.eicData).includes('uncommitted'));
const revision=JSON.parse(s.getItem(KEY)).revision;
s.map.set(JOURNAL,JSON.stringify({from:revision,to:revision+1}));store=make(s);assert.equal(s.getItem(KEYS.eicData),'[]');assert.equal(s.getItem(JOURNAL),null);
// Two windows cannot overwrite each other's committed business data.
const second=make(s);store.commit('one window',d=>{d.rates.Staff=701;});assert.throws(()=>second.commit('stale',d=>{d.rates.Staff=702;}),/另一窗口/);
// Recent history is bounded and still replayable after refresh.
for(let i=0;i<70;i++)store.commit('rate '+i,d=>{d.rates.Staff=800+i;});
assert.equal(store.getHistory().past.length,50);store=make(s);
for(let i=0;i<50;i++)store.undo();assert.equal(store.getState().rates.Staff,819);
for(let i=0;i<50;i++)store.redo();assert.equal(store.getState().rates.Staff,869);
// Large arrays are represented by changed spans and replay without argument limits.
const a={...clone(defaults),eicData:Array.from({length:100000},(_,i)=>i)},b=clone(a);b.eicData[99990]=-1;
const diff=changes(a,b);assert.equal(diff[0].before.length,1);assert.deepStrictEqual(apply(a,diff,true),b);assert.deepStrictEqual(apply(b,diff,false),a);
const c={...clone(defaults),eicData:[]};assert.deepStrictEqual(apply(c,changes(c,a),true),a);
// Invalid legacy data is never silently cleared on first launch.
const bad=storage();bad.map.set(KEYS.taskLists,'broken');assert.throws(()=>make(bad),/原始内容已保留/);assert.equal(bad.getItem(KEYS.taskLists),'broken');assert.equal(bad.getItem(KEY),null);
// Explicit capacity trimming retains the new action, its inverse and a notice.
const small=make(storage(),{maxChars:900});for(let i=0;i<12;i++)small.commit('change '+i,d=>{d.rates.Staff=i;});assert(small.getHistory().past.length<12);assert(small.getHistory().notice);small.undo();assert.equal(small.getState().rates.Staff,10);
// Jump through a retained timeline without committing intermediate states.
const jumpStorage=storage();let jump=make(jumpStorage);
const snapshots=[],ids=[];
for(let i=1;i<=6;i++){
  jump.commit('step '+i,d=>{
    d.eicData.push({name:'Person.'+i,hrs:i});d.ouData=[{name:'Person.'+i,hrs:i*2}];
    d.budgetData=[{budgetHrs:i}];d.rates.Staff=683+i;d.timesheetData=[{hrs:i}];
    d.projects=[{fic:'Person.'+i,nodes:[{completed:i%2?'N':'Y'}]}];
    d.taskLists=[{assignees:['Person.'+i]}];d.matches={'pending':{name:'Person.'+i}};
  });
  snapshots.push(clone(jump.getState()));ids.push(jump.getHistory().past.at(-1).id);
}
let notifications=0;const unsubscribe=jump.subscribe(()=>notifications++);
let priorRevision=JSON.parse(jumpStorage.getItem(KEY)).revision;
jump.restoreTo(ids[1]);assert.deepStrictEqual(jump.getState(),snapshots[1]);
assert.equal(notifications,1);assert.equal(JSON.parse(jumpStorage.getItem(KEY)).revision,priorRevision+1);
assert.deepStrictEqual(jump.getHistory().past.map(e=>e.id),ids.slice(0,2));
assert.deepStrictEqual(jump.getHistory().future.map(e=>e.id),ids.slice(2).reverse());
for(const [field,key] of Object.entries(KEYS))assert.deepStrictEqual(JSON.parse(jumpStorage.getItem(key)),snapshots[1][field]);
const noOpRaw=new Map(jumpStorage.map);jump.restoreTo(ids[1]);assert.deepStrictEqual(jumpStorage.map,noOpRaw);assert.equal(notifications,1);
unsubscribe();jump=make(jumpStorage);assert.deepStrictEqual(jump.getState(),snapshots[1]);
jump.restoreTo(ids[4]);assert.deepStrictEqual(jump.getState(),snapshots[4]);
jump.undo();assert.deepStrictEqual(jump.getState(),snapshots[3]);jump.redo();assert.deepStrictEqual(jump.getState(),snapshots[4]);
jump.restoreTo(ids[0]);jump.undo();assert.deepStrictEqual(jump.getState(),defaults);
jump.restoreTo(ids[5]);assert.deepStrictEqual(jump.getState(),snapshots[5]);assert.equal(jump.getHistory().past.length,6);
// Failure at the commit point or a midway mirror preserves ALL data and history.
for(const failureKey of [KEY,KEYS.taskLists]){
  const beforeRaw=new Map(jumpStorage.map),beforeData=clone(jump.getState()),beforeHistory=clone(jump.getHistory());
  let calls=0;const stop=jump.subscribe(()=>calls++);jumpStorage.fail=key=>key===failureKey;
  assert.throws(()=>jump.restoreTo(ids[1]),/未提交/);stop();jumpStorage.fail=null;
  assert.equal(calls,0);assert.deepStrictEqual(jumpStorage.map,beforeRaw);
  assert.deepStrictEqual(jump.getState(),beforeData);assert.deepStrictEqual(jump.getHistory(),beforeHistory);
}
// A bad intermediate patch must fail before anything is saved, in either direction.
for(const direction of ['backward','forward']){
  const brokenStorage=storage();for(const [key,value] of jumpStorage.map)brokenStorage.map.set(key,value);
  let broken=make(brokenStorage);if(direction==='forward')broken.restoreTo(ids[0]);
  const envelope=JSON.parse(brokenStorage.getItem(KEY));
  const entry=[...envelope.past,...envelope.future].find(e=>e.id===ids[3]);
  entry.changes.find(p=>p.key==='rates')[direction==='forward'?'before':'after']={Staff:-999};
  brokenStorage.map.set(KEY,JSON.stringify(envelope));broken=make(brokenStorage);
  const beforeRaw=new Map(brokenStorage.map),beforeData=clone(broken.getState()),beforeHistory=clone(broken.getHistory());
  assert.throws(()=>broken.restoreTo(direction==='forward'?ids[5]:ids[0]),/历史记录与当前数据不一致/);
  assert.deepStrictEqual(brokenStorage.map,beforeRaw);assert.deepStrictEqual(broken.getState(),beforeData);assert.deepStrictEqual(broken.getHistory(),beforeHistory);
}
// New edits replace only the future branch; unknown/expired targets cannot write.
jump.restoreTo(ids[1]);jump.commit('new branch after jump',d=>{d.rates.Staff=999;});assert.equal(jump.getHistory().future.length,0);
const beforeExpired=new Map(jumpStorage.map);assert.throws(()=>jump.restoreTo(ids[5]),/不在保留的历史/);assert.deepStrictEqual(jumpStorage.map,beforeExpired);
jump.undo();assert.deepStrictEqual(jump.getState(),snapshots[1]);jump.redo();assert.equal(jump.getState().rates.Staff,999);
const staleJump=make(jumpStorage);jump.commit('another window',d=>{d.rates.Staff=1000;});
assert.throws(()=>staleJump.restoreTo(ids[0]),/另一窗口/);
const retained=make(storage());let expiredId;
for(let i=1;i<=70;i++){retained.commit('retained '+i,d=>{d.rates.Staff=i;});if(i===1)expiredId=retained.getHistory().past[0].id;}
const retainedIds=retained.getHistory().past.map(e=>e.id);
assert.throws(()=>retained.restoreTo(expiredId),/不在保留的历史/);
retained.restoreTo(retainedIds[0]);assert.equal(retained.getState().rates.Staff,21);
retained.restoreTo(retainedIds[49]);assert.equal(retained.getState().rates.Staff,70);assert.equal(retained.getHistory().past.length,50);
console.log('PASS: atomic multi-module history, direct restore / return, persistence, no-op and branches, clear recovery, interrupted-write recovery, quota / mirror / intermediate-patch rollback, concurrency and 50-step capacity.');
// Upgrade a pre-master-data workspace without changing its business history.
const upgradeStorage=storage();const legacyData=clone(defaults);delete legacyData.masterData;
const legacy={version:1,revision:7,data:legacyData,past:[],future:[]};
upgradeStorage.map.set(KEY,JSON.stringify(legacy));
Object.entries(KEYS).filter(([field])=>field!=='masterData').forEach(([field,key])=>upgradeStorage.map.set(key,JSON.stringify(legacyData[field])));
const master=[{name:'New.Person',email:'new@example.com',level:'Staff',fic:'New.Person',eic:'Lead.Person'}];
const upgraded=create(upgradeStorage,{defaults:{...defaults,masterData:master}});
assert.deepStrictEqual(upgraded.getState(),{...legacyData,masterData:master});assert.equal(upgraded.getHistory().past.length,0);
assert.deepStrictEqual(create(upgradeStorage,{defaults:{...defaults,masterData:[]}}).getState().masterData,master);
console.log('PASS: legacy workspace migration preserves business data and history and persists master data');
