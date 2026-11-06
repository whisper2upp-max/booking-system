/* Local personnel master and explicit pending-name matching. No network access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BookingStaff = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // BEGIN GENERATED MASTER
  const source = {kind:"user-managed"};
  const rawMaster = [];
  // END GENERATED MASTER

  const matchesKey = 'booking-pending-staff-matches-v1';
  const englishName = /^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*$/;
  const chineseName = /^[\u3400-\u9fff·]+$/;
  const key = value => String(value || '').trim().toLowerCase();
  const isChineseName = value => chineseName.test(String(value || '').trim());
  const isBookingName = value => englishName.test(String(value || '').trim()) || isChineseName(value);
  let activeRecords = null;
  function normalizeName(value) {
    const raw=String(value||'').normalize('NFKC').trim();
    const compact=v=>String(v||'').toLowerCase().replace(/[.\s]/g,'');
    const candidates=(activeRecords || rawMaster).filter(p=>compact(p.name)===compact(raw)||p.chineseName===raw||key(p.email)===key(raw));
    if(candidates.length===1)return candidates[0].name;
    const name=raw.replace(/[.\s]+/g,'.').replace(/^\.|\.$/g,'');
    if (!englishName.test(name)) return name;
    const parts = name.split('.');
    return parts.map((p, i) => i === 0 || i === parts.length - 1
      ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p.toUpperCase()).join('.');
  }
  const master = rawMaster.map(person => ({...person, name:normalizeName(person.name), eic:normalizeName(person.eic)}));
  function setMaster(records){master.splice(0,master.length,...records.map(p=>({...p})));activeRecords=master;}
  function findByEmail(email, records = master) {
    const value = key(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
    const found = records.filter(person => key(person.email) === value);
    return found.length === 1 ? found[0] : null;
  }
  function findByName(name, records = master) {
    const value = key(name);
    if (!value) return null;
    const compact=v=>key(v).replace(/[.\s]/g,'');
    const found = records.filter(person => compact(person.name) === compact(value));
    return found.length === 1 ? found[0] : null;
  }
  function isPendingName(name, records = master) {
    if (!key(name)) return false;
    const person = findByName(name, records);
    return !person || person.status === 'pending';
  }
  function isFicName(name, records = master) {
    const person = findByName(name, records);
    return !!person && ['senior', 'staff'].includes(key(person.level));
  }
  function loadMatches(storage) {
    try {
      const value = JSON.parse(storage.getItem(matchesKey) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) { return {}; }
  }
  function resolve(identifier, matches = {}, records = master) {
    const value = String(identifier || '').trim();
    if (!value || value === '暂无') return null;
    const direct = findByEmail(value, records) || findByName(value, records);
    // A current formal identity takes precedence over an older alias.
    if (direct && direct.status !== 'pending') return direct;
    const supplied = records.filter(person => person.chineseName && key(person.chineseName) === key(value) && person.status !== 'pending');
    if (supplied.length === 1) return supplied[0];
    // Retain user-confirmed mappings for names absent from the supplied master.
    const alias = matches[key(value)];
    if (alias && typeof alias === 'object') {
      const target = findByEmail(alias.email, records) || findByName(alias.name, records);
      if (target && target.status !== 'pending' && englishName.test(target.name)) return target;
    }
    return direct;
  }
  function prepareEntry(entry, matches = {}, records = master) {
    const direct=findByName(entry.name,records);
    if(direct&&direct.status!=='pending')return {...entry,name:direct.name,pending:false};
    const name = String(entry.name).trim();
    const person = resolve(name, matches, records);
    return person ? {...entry, name:person.name, level:person.level, eic:person.eic,
      email:person.email || '', pending:person.status === 'pending', pendingSourceName:entry.pendingSourceName || name}
      : {...entry, name, pending:true};
  }
  function listPending(eicData, ouData, records = master, workspace = {}) {
    const groups = new Map();
    for (const [scope, entries] of [['eic', eicData], ['ou', ouData]]) {
      for (const entry of entries) {
        if (!isPendingName(entry.name, records)) continue;
        const name = String(entry.name).trim(), id = key(name);
        if (!groups.has(id)) groups.set(id, {name, eicRows:0, ouRows:0, hours:0, eics:new Set()});
        const group = groups.get(id);
        group[scope + 'Rows']++;
        group.hours += Number(entry.hrs) || 0;
        if (entry.eic) group.eics.add(entry.eic);
      }
    }
    const addReference=name=>{
      if(!name||!/^Dummy\./i.test(name)||!isPendingName(name,records))return;
      const id=key(name);
      if(!groups.has(id))groups.set(id,{name,eicRows:0,ouRows:0,hours:0,eics:new Set()});
      const group=groups.get(id);group.referenceCount=(group.referenceCount||0)+1;
    };
    [...(eicData||[]),...(ouData||[])].forEach(row=>addReference(row.eic));
    (workspace.projects||[]).forEach(p=>{addReference(p.fic);addReference(p.teamFic);String(p.eic||'').split(/[,，;；]/).map(n=>n.trim()).forEach(addReference);});
    (workspace.timesheetData||[]).forEach(row=>addReference(row.employeeName));
    (workspace.taskLists||[]).forEach(s=>{(s.tasks||[]).forEach(t=>{(t.assignees||[]).forEach(addReference);addReference(t.sourceManager);});Object.values(s.sourceMeta||{}).forEach(t=>addReference(t.sourceManager));});
    (workspace.masterData||[]).forEach(p=>{addReference(p.eic);if(/^Dummy\./i.test(p.fic||''))addReference(p.fic);});
    groups.forEach(group=>{group.originalName=workspace.matches?.[key(group.name)]?.sourceName||'';});
    return Array.from(groups.values(), item => ({...item, eics:Array.from(item.eics)}))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
  function createMatchPlan(data, choices, previousMatches = {}, records = master) {
    const pending = new Set(listPending(data.eicData, data.ouData, records, data).map(person => key(person.name)));
    const targets = new Map(), usedTargets = new Set();
    for (const [name, identifier] of Object.entries(choices)) {
      if (!identifier) continue;
      if (!pending.has(key(name))) throw new Error('待匹配排班已变化，请重新选择：' + name);
      const target = findByEmail(identifier, records);
      if (!target || target.status === 'pending' || !englishName.test(target.name)) throw new Error('请选择最新主数据中的正式人员：' + name);
      if (usedTargets.has(key(target.email))) throw new Error('不同 Pending 人员不能同时匹配到同一正式人员。');
      if ((data.projects || []).some(project => ['fic', 'teamFic'].some(field => key(project[field]) === key(name))) && !isFicName(target.name, records)) {
        throw new Error(name + ' 同时担任项目 FIC，请匹配到 masterdata 中的 Senior 或 Staff；Manager 不能担任 FIC。');
      }
      usedTargets.add(key(target.email));
      targets.set(key(name), target);
    }
    if (targets.size === 0) throw new Error('请至少选择一名对应的正式人员。');
    const matches = {...previousMatches};
    targets.forEach((person, name) => { matches[key(name)] = {name:person.name, email:person.email}; });
    Object.entries(matches).forEach(([alias,value])=>{const target=targets.get(key(value.name));if(target)matches[alias]={...value,name:target.name,email:target.email,unmatched:false};});
    const formalTargets = new Map(Array.from(targets.values(), person => [key(person.name), person]));
    let changedRows = 0, overlapRows = 0, mergedRows = 0, taskReferences = 0, projectReferences = 0;
    const bookingKey = entry => [key(entry.name), entry.week, entry.engagementCode, key(entry.eic)].join('|');
    const convert = entries => {
      const existing = new Set(entries.filter(entry => !targets.has(key(entry.name))).map(entry => {
        const person = formalTargets.get(key(entry.name));
        return bookingKey(person ? {...entry, name:person.name, eic:person.eic} : entry);
      }));
      const affected = new Set();
      const converted = entries.map(entry => {
        const source = targets.get(key(entry.name));
        const person = source || formalTargets.get(key(entry.name));
        if (!person) return entry;
        const next = {...entry, name:person.name, level:person.level, eic:person.eic, email:person.email,
          pending:false};
        if (source) next.pendingSourceName = entry.pendingSourceName || String(entry.name).trim();
        if (source || ['name','level','eic','email','pending'].some(field => entry[field] !== next[field])) changedRows++;
        affected.add(bookingKey(next));
        if (source && existing.has(bookingKey(next))) overlapRows++;
        return next;
      });
      // Consolidate only identities affected by this match. OU's existing union
      // uses one row per name/week/project/EIC, so retaining duplicate keys here
      // would hide part of the person's hours in the OU view.
      const positions = new Map(), result = [];
      for (const entry of converted) {
        const id = bookingKey(entry);
        if (!affected.has(id)) { result.push(entry); continue; }
        if (!positions.has(id)) { positions.set(id, result.length); result.push(entry); continue; }
        const index = positions.get(id), previous = result[index];
        const person = formalTargets.get(key(entry.name));
        result[index] = {...previous, ...entry, name:person.name, level:person.level, eic:person.eic, email:person.email, pending:false,
          hrs:(Number(previous.hrs)||0)+(Number(entry.hrs)||0),
          pendingSourceName:previous.pendingSourceName || entry.pendingSourceName};
        mergedRows++;
      }
      return result;
    };
    const rename = name => targets.get(key(name))?.name || name;
    const renameList=value=>typeof value==='string'?value.split(/[,，;；]/).map(n=>rename(n.trim())).join(','):value;
    const eicData=convert(data.eicData).map(row=>({...row,eic:rename(row.eic)})),ouData=convert(data.ouData).map(row=>({...row,eic:rename(row.eic)}));
    const projects=(data.projects||[]).map(p=>{
      const next={...p,fic:rename(p.fic),teamFic:rename(p.teamFic),eic:renameList(p.eic)};
      if(['fic','teamFic','eic'].some(k=>next[k]!==p[k]))projectReferences++;
      return next;
    });
    const taskLists=(data.taskLists||[]).map(s=>({...s,tasks:(s.tasks||[]).map(t=>{
      if((t.assignees||[]).some(n=>rename(n)!==n)||rename(t.sourceManager)!==t.sourceManager)taskReferences++;
      return {...t,assignees:Array.from(new Set((t.assignees||[]).map(rename))),sourceManager:rename(t.sourceManager)};
    }),...(s.sourceMeta?{sourceMeta:Object.fromEntries(Object.entries(s.sourceMeta).map(([k,v])=>[k,{...v,sourceManager:rename(v.sourceManager)}]))}:{})}));
    const timesheetData=(data.timesheetData||[]).map(row=>({...row,employeeName:rename(row.employeeName)}));
    const masterData=data.masterData?.map(p=>({...p,eic:rename(p.eic),fic:rename(p.fic)}));
    return {eicData,ouData,projects,taskLists,matches,timesheetData,masterData,changedRows,overlapRows,mergedRows,taskReferences,projectReferences,people:targets.size};
  }

  function saveAtomically(storage, updates) {
    const original = Object.keys(updates).map(name => [name, storage.getItem(name)]);
    const written = [];
    try {
      for (const [name, value] of Object.entries(updates)) {
        storage.setItem(name, JSON.stringify(value));
        written.push(name);
      }
    } catch (error) {
      for (const [name, value] of original.reverse()) {
        if (!written.includes(name)) continue;
        try { value === null ? storage.removeItem(name) : storage.setItem(name, value); } catch (_) {}
      }
      throw new Error('匹配结果未能保存，请检查浏览器存储空间后重试。');
    }
  }
  return {source, master, setMaster, matchesKey, normalizeName, isChineseName, isPendingName, isBookingName, isFicName,
    findByEmail, findByName, resolve, loadMatches, prepareEntry, listPending, createMatchPlan, saveAtomically};
});
