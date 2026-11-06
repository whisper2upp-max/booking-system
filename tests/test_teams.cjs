const assert=require('assert'),T=require('../app/team-data.js');
const empty=()=>({masterData:[],eicData:[],budgetData:[],rates:{Staff:1},timesheetData:[],projects:[],taskLists:[],matches:{}});
const identity=(role,name,id)=>({role,name,id,eic:'Lead.Person'});
const wrap=(id,hrs,project='P'+id)=>{const d=empty();d.masterData=[{name:'Shared.Person',email:'shared@example.com',level:'Staff',fic:'A.Person',eic:'Lead.Person'}];d.eicData=[{name:'Shared.Person',eic:'Lead.Person',level:'Staff',engagementCode:project,week:'2026-11-06',hrs}];d.matches[T.KEY]={identity:identity('FIC',id+'.Person',id),sources:[],owners:{},people:{},rateSource:''};return{data:d,team:d.matches[T.KEY],exportedAt:'2026-11-06T00:00:00Z'}};
let current=empty();current.matches[T.KEY]={identity:identity('EIC','Lead.Person','manager'),sources:[],owners:{},people:{},rateSource:''};
const merge=(d,b)=>{const p=T.plan(d,b);p.meta.rateSource=p.meta.rateSource||p.entry.id;return T.materialize(d,p.meta)};
current=merge(current,wrap('A',20));current=merge(current,wrap('B',20));assert.equal(current.eicData.reduce((n,r)=>n+r.hrs,0),40);assert.equal(current.masterData.length,1);
let next=wrap('A',12);next.exportedAt='2026-11-13T00:00:00Z';current=merge(current,next);assert.equal(current.eicData.reduce((n,r)=>n+r.hrs,0),32);assert.equal(current.eicData.filter(r=>r.sourceFicId==='B').length,1);
assert.throws(()=>T.plan(current,next),/旧版或重复/);let p=T.plan(current,next,null,true);p.meta.rateSource='A';current=T.materialize(current,p.meta);assert.equal(current.eicData.length,2);
next=wrap('A',0);next.data.eicData=[];next.exportedAt='2026-11-20T00:00:00Z';current=merge(JSON.parse(JSON.stringify(current)),next);assert.equal(current.eicData.reduce((n,r)=>n+r.hrs,0),20);
assert.throws(()=>T.plan(current,{...next,team:{identity:{role:'EIC'}}}),/整份恢复/);
const shared=wrap('C',20,'PB');shared.data.budgetData=[{engagementCode:'PB',budgetHrs:100}];current=merge(current,shared);const b=wrap('B',20,'PB');b.exportedAt='2026-11-21T00:00:00Z';b.data.budgetData=[{engagementCode:'PB',budgetHrs:100}];p=T.plan(current,b);assert.equal(p.conflicts.projects.length,1);assert.throws(()=>T.materialize(current,p.meta),/共享项目/);p.meta.owners.PB='B';current=T.materialize(current,p.meta);assert.equal(current.budgetData.length,1);assert.equal(current.budgetData[0].budgetHrs,100);assert.equal(current.eicData.reduce((n,r)=>n+r.hrs,0),40);
assert.equal(T.metadata(current).identity.role,'EIC');assert.equal(T.metadata(current).sources.length,3);assert(T.fileName({team:T.metadata(current),exportedAt:new Date().toISOString()}).startsWith('Booking-EIC-Lead.Person-'));
console.log('PASS source replacement, shared person 40→32→20, repeated/old protection, EIC rejection, preserved sources through JSON restore, shared project selection prevents double budget, same project bookings add');

const removed=wrap('B',20,'PB');removed.exportedAt='2026-11-28T00:00:00Z';current=merge(current,removed);assert.equal(current.budgetData.length,1);assert.equal(current.budgetData[0].sourceFicId,'C');console.log('PASS removing selected shared-project data falls back to remaining source without losing it');
