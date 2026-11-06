/* Version-independent settings; business data and directory grants stay separate. */
(function(root){
  const INTERVAL=2*60*60*1000,DB='booking-auto-backup',LOCK='booking-auto-backup-write';
  function persistence(){
    const opened=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>r.result.createObjectStore('settings');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return {async get(){const db=await opened;return new Promise((resolve,reject)=>{const r=db.transaction('settings').objectStore('settings').get('directory');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});},async put(value){const db=await opened;return new Promise((resolve,reject)=>{const tx=db.transaction('settings','readwrite');tx.objectStore('settings').put(value,'directory');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('设置保存失败'));});}};
  }
  function create({getSnapshot,encode,onChange=()=>{},storage=persistence(),now=()=>Date.now(),picker=()=>root.showDirectoryPicker({mode:'readwrite',id:'booking-backups'}),withLock=fn=>root.navigator.locks.request(LOCK,fn)}){
    let config=null,busy=false,state={ready:false,supported:typeof root.showDirectoryPicker==='function'&&!!root.navigator?.locks,folder:'',permission:'prompt',lastSuccess:0,error:''};
    const emit=patch=>{state={...state,...patch};onChange({...state});return state;};
    const message=e=>e?.name==='NotAllowedError'?'文件夹未获写入授权，请点击“授权原文件夹”。':e?.name==='SecurityError'?'浏览器禁止访问此文件夹，请使用桌面版 Chrome / Edge 并选择允许读写的目录。':e?.name==='NotFoundError'?'备份文件夹不可用，请检查磁盘连接或重新选择文件夹。':(e?.message||'自动备份失败，请检查文件夹和磁盘空间。');
    async function load(){
      try{config=await storage.get();const permission=config?await config.handle.queryPermission({mode:'readwrite'}):'prompt';emit({ready:true,folder:config?.handle.name||'',permission,lastSuccess:config?.lastSuccess||0,error:''});}
      catch(e){emit({ready:true,error:message(e)});}
      return state;
    }
    async function choose(){
      // Picker must run directly in the click gesture, before storage awaits.
      let handle;try{handle=await picker();}catch(e){if(e.name!=='AbortError')emit({error:message(e)});return false;}
      try{await withLock(async()=>{const old=await storage.get();config={handle,owner:old?.owner||root.crypto.randomUUID(),lastSuccess:0};await storage.put(config);});emit({folder:handle.name,permission:'granted',lastSuccess:0,error:''});await run(true);return true;}
      catch(e){emit({error:message(e)});return false;}
    }
    async function authorize(){
      try{if(!config)return false;const permission=await config.handle.requestPermission({mode:'readwrite'});emit({permission,error:permission==='granted'?'':'未获得写入授权，自动备份尚未启用。'});if(permission==='granted'){await run();return true;}}catch(e){emit({error:message(e)});}return false;
    }
    async function run(force=false){
      if(busy||!state.supported||!config)return false;
      busy=true;emit({busy:true});
      try{return await withLock(async()=>{
        config=await storage.get();if(!config)return false;
        const permission=await config.handle.queryPermission({mode:'readwrite'});emit({folder:config.handle.name,lastSuccess:config.lastSuccess||0,permission});
        if(permission!=='granted')return false;
        if(!force&&config.lastSuccess&&now()-config.lastSuccess<INTERVAL)return false;
        const backup=await encode(getSnapshot()),stamp=Math.max(now(),(config.lastSuccess||0)+1);
        const prefix='Booking-System-Auto-'+config.owner+'-';
        const name=prefix+String(stamp)+'-'+(root.BookingTeams?root.BookingTeams.fileName(backup,true):'backup.json');
        const file=await config.handle.getFileHandle(name,{create:true});
        let stream;try{stream=await file.createWritable();await stream.write(JSON.stringify(backup,null,2));await stream.close();}catch(e){try{await stream?.abort();await config.handle.removeEntry(name);}catch(_){}throw e;}
        // Only this installation’s automatic-backup namespace is eligible for pruning.
        const candidates=[];
        for await(const [filename,entry]of config.handle.entries()){
          if(entry.kind!=='file'||!filename.startsWith(prefix)||!/^\d{13}(?:\.json|-Booking-.+\.json|-backup\.json)$/.test(filename.slice(prefix.length)))continue;
          candidates.push(filename);
        }
        candidates.sort();
        for(const filename of candidates.slice(0,Math.max(0,candidates.length-5)))await config.handle.removeEntry(filename);
        config={...config,lastSuccess:stamp};await storage.put(config);emit({lastSuccess:stamp,error:''});return true;
      });}catch(e){emit({error:message(e)});return false;}finally{busy=false;emit({busy:false});}
    }
    return {load,choose,authorize,run,getState:()=>({...state})};
  }
  root.BookingAutoBackup={create,persistence,INTERVAL};
  if(typeof module!=='undefined')module.exports=root.BookingAutoBackup;
})(typeof window!=='undefined'?window:globalThis);
