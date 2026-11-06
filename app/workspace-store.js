/* Offline business transactions. The envelope is the commit record; legacy keys
 * are compatibility mirrors. Recovery always follows the committed envelope. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookingWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'booking-workspace-v3';
  const JOURNAL = KEY+'-write';
  const KEYS = {
    eicData:'booking-eic-data', ouData:'booking-ou-data', budgetData:'booking-budget-data',
    rates:'booking-rates', timesheetData:'booking-timesheet-data', projects:'pn-projects-v3',
    masterData:'booking-master-data-v1', taskLists:'pn-tasklists-v1', matches:'booking-pending-staff-matches-v1'
  };
  const clone = x => JSON.parse(JSON.stringify(x));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function changes(before, after) {
    return Object.keys(KEYS).flatMap(key => {
      const a=before[key], b=after[key];
      if (same(a,b)) return [];
      if (!Array.isArray(a) || !Array.isArray(b)) return [{key,before:a,after:b}];
      let start=0, end=0;
      while(start<a.length && start<b.length && same(a[start],b[start])) start++;
      while(end<a.length-start && end<b.length-start && same(a[a.length-1-end],b[b.length-1-end])) end++;
      return [{key,start,before:a.slice(start,a.length-end),after:b.slice(start,b.length-end)}];
    });
  }
  function apply(data, patches, forward) {
    const next=clone(data);
    patches.forEach(p => {
      const expected=forward?p.before:p.after, replacement=forward?p.after:p.before;
      if (p.start === undefined) {
        if (!same(next[p.key],expected)) throw new Error('历史记录与当前数据不一致，未执行撤销或重做。');
        next[p.key]=clone(replacement);
      } else {
        if (!same(next[p.key].slice(p.start,p.start+expected.length),expected)) throw new Error('历史记录与当前数据不一致，未执行撤销或重做。');
        next[p.key]=next[p.key].slice(0,p.start).concat(clone(replacement),next[p.key].slice(p.start+expected.length));
      }
    });
    return next;
  }
  function validate(data, defaults) {
    if (!data || typeof data !== 'object') throw new Error('本地数据无法读取。');
    Object.keys(KEYS).forEach(k => {
      if (Array.isArray(defaults[k]) ? !Array.isArray(data[k]) : !data[k] || typeof data[k] !== 'object' || Array.isArray(data[k]))
        throw new Error('本地 '+KEYS[k]+' 格式异常；为保留原数据，已停止写入。');
    });
  }
  function create(storage, options) {
    const defaults=clone({...options.defaults,masterData:options.defaults.masterData||[]}), maxSteps=options.maxSteps||50, maxChars=options.maxChars||1600000;
    const reconcile=options.reconcile||((x)=>x);
    let committedRaw=storage.getItem(KEY), state, notice='', listeners=new Set(), migrateMaster=false;
    if (committedRaw) {
      try {
        state=JSON.parse(committedRaw);
        if(state.version!==1 || !Array.isArray(state.past) || !Array.isArray(state.future)) throw new Error();
        migrateMaster=!Object.prototype.hasOwnProperty.call(state.data,'masterData');
        if(migrateMaster)state.data.masterData=clone(defaults.masterData);
        validate(state.data,defaults);
      } catch(e) { throw new Error('本地数据或操作历史无法读取，原始内容已保留。请联系管理员检查浏览器存储。'); }
      // Recover only a known interrupted transaction. Unexpected edits from an
      // older version must not be silently overwritten on reload.
      const journal=storage.getItem(JOURNAL);
      const drift=Object.entries(KEYS).some(([field,key])=>!(migrateMaster&&field==='masterData')&&storage.getItem(key)!==JSON.stringify(state.data[field]));
      if(drift&&!journal)throw new Error('检测到旧版或其他页面改动了同一存储中的数据，已停止写入并保留两份内容。请联系管理员核对。');
      if(journal){
        let marker;try{marker=JSON.parse(journal);}catch(e){}
        if(!marker||![marker.from,marker.to].includes(state.revision))throw new Error('未完成的保存记录无法核对，原数据已保留，请联系管理员。');
        syncMirrors(state.data);storage.removeItem(JOURNAL);
      }
    } else {
      const loaded=clone(defaults);
      Object.entries(KEYS).forEach(([field,key]) => {
        const raw=storage.getItem(key);
        if (raw!==null) {
          try { loaded[field]=JSON.parse(raw); }
          catch(e) { throw new Error(key+' 无法读取；原始内容已保留，请联系管理员。'); }
        }
      });
      validate(loaded,defaults);
      const data=reconcile(options.normalize?options.normalize(loaded):loaded,null);
      state={version:1,revision:0,data,past:[],future:[]};
      persist(state);
    }
    if(migrateMaster){state={...state,revision:state.revision+1};persist(state);}
    function syncMirrors(data) {
      Object.entries(KEYS).forEach(([field,key]) => {
        const value=JSON.stringify(data[field]);
        if(storage.getItem(key)!==value) storage.setItem(key,value);
      });
    }
    function ensureFresh() {
      if(storage.getItem(KEY)!==committedRaw) throw new Error('另一窗口已修改数据，请刷新此窗口后继续，避免覆盖新的修改。');
      if(Object.entries(KEYS).some(([field,key]) => storage.getItem(key)!==JSON.stringify(state.data[field])))
        throw new Error('检测到其他页面修改了本地数据，请关闭旧版页面并刷新程序后继续。');
    }
    function persist(candidate, {preserveHistory=false}={}) {
      const originals=Object.fromEntries(Object.values(KEYS).map(key=>[key,storage.getItem(key)]));
      let trimmed=0;
      if(!preserveHistory){
        while (candidate.past.length>maxSteps) {candidate.past.shift();trimmed++;}
        while (JSON.stringify(candidate).length>maxChars && candidate.past.length>1) {candidate.past.shift();trimmed++;}
      }
      for (;;) {
        try {
          storage.setItem(JOURNAL,JSON.stringify({from:committedRaw?JSON.parse(committedRaw).revision:null,to:candidate.revision}));
          syncMirrors(candidate.data);
          const raw=JSON.stringify(candidate);
          storage.setItem(KEY,raw); // The sole commit point: state AND history.
          committedRaw=raw;
          try{storage.removeItem(JOURNAL);}catch(e){} // Recovery can finish cleanup.
          if(trimmed) notice='历史已按容量保留最近 '+candidate.past.length+' 步。较早操作已移出撤销范围。';
          return;
        } catch(e) {
          let rollbackFailed=false;
          Object.entries(originals).forEach(([key,value])=>{
            try {
              if(storage.getItem(key)!==value) value===null?storage.removeItem(key):storage.setItem(key,value);
            } catch(err) {rollbackFailed=true;}
          });
          if(rollbackFailed) throw new Error('本地存储不可用，修改未提交。请刷新以从已提交记录恢复，暂勿继续编辑。');
          try{storage.removeItem(JOURNAL);}catch(err){}
          // Keep this action undoable, even if its older predecessors need eviction.
          if(!preserveHistory && candidate.past.length>1) {candidate.past.shift();trimmed++;continue;}
          throw new Error('保存失败：浏览器本地存储空间不足或不可用。本次数据与历史均未提交。');
        }
      }
    }
    function publish(candidate, options) {
      persist(candidate,options); state=candidate;
      listeners.forEach(fn=>fn()); return state.data;
    }
    const api={
      getState:()=>state.data,
      getHistory:()=>({past:state.past,future:state.future,notice}),
      subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
      commit(label, producer) {
        ensureFresh();
        const draft=clone(state.data);
        const produced=producer(draft);
        const next=reconcile(produced===undefined?draft:produced,state.data);
        validate(next,defaults);
        const diff=changes(state.data,next);
        if(!diff.length) return state.data;
        const entry={id:Date.now()+'_'+Math.random().toString(36).slice(2),label,time:new Date().toISOString(),changes:diff};
        return publish({version:1,revision:state.revision+1,data:next,past:[...state.past,entry],future:[]});
      },
      replaceAll(data) {
        ensureFresh();
        const next=clone(data);
        validate(next,defaults);
        const diff=changes(state.data,next);
        if(!diff.length)return state.data;
        const entry={id:Date.now()+'_'+Math.random().toString(36).slice(2),label:'恢复全部数据',time:new Date().toISOString(),changes:diff};
        // A full snapshot is authoritative: do not derive or rename imported projects.
        return publish({version:1,revision:state.revision+1,data:next,past:[...state.past,entry],future:[]});
      },
      undo() {
        ensureFresh();
        if(!state.past.length) return state.data;
        const entry=state.past[state.past.length-1];
        return publish({...state,revision:state.revision+1,data:apply(state.data,entry.changes,false),past:state.past.slice(0,-1),future:[...state.future,entry]});
      },
      redo() {
        ensureFresh();
        if(!state.future.length) return state.data;
        const entry=state.future[state.future.length-1];
        return publish({...state,revision:state.revision+1,data:apply(state.data,entry.changes,true),past:[...state.past,entry],future:state.future.slice(0,-1)});
      },
      restoreTo(entryId) {
        ensureFresh();
        const timeline=[...state.past,...state.future.slice().reverse()];
        const index=timeline.findIndex(entry=>entry.id===entryId);
        if(index<0) throw new Error('这条操作已不在保留的历史中，无法恢复。');
        const target=index+1, current=state.past.length;
        if(target===current) return state.data;
        // Resolve every intervening change in memory before a single commit.
        // Do not reconcile again: related changes are already in these entries.
        let data=state.data;
        if(target<current){
          for(let i=current-1;i>=target;i--) data=apply(data,timeline[i].changes,false);
        }else{
          for(let i=current;i<target;i++) data=apply(data,timeline[i].changes,true);
        }
        validate(data,defaults);
        // A jump moves the cursor, keeps both sides of the timeline and consumes
        // no new history step. If storage fails, retain the original timeline.
        return publish({...state,revision:state.revision+1,data,past:timeline.slice(0,target),future:timeline.slice(target).reverse()},{preserveHistory:true});
      }
    };
    return api;
  }
  return {KEY,KEYS,JOURNAL,create,changes,apply};
});
