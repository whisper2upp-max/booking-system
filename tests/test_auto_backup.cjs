const assert=require('assert');global.showDirectoryPicker=()=>{};const {create,INTERVAL}=require('../app/auto-backup.js');
(async()=>{
 let saved,t=1793757477122,fail=false,removed=[],files=new Map([['my-important-file.json','keep']]),writes=0;
 const handle={name:'Backup',permission:'granted',async queryPermission(){return this.permission},async requestPermission(){return this.permission='granted'},async getFileHandle(name){return {async createWritable(){let contents;return {async write(v){if(fail)throw Error('Disk full');contents=v},async close(){files.set(name,contents);writes++},async abort(){}}}}},async *entries(){for(const n of files.keys())yield[n,{kind:'file'}]},async removeEntry(n){removed.push(n);files.delete(n)}};
 const storage={async get(){return saved},async put(v){saved={...v}}};let queue=Promise.resolve();const withLock=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
 const options={getSnapshot:()=>({test:1}),encode:async d=>({data:d,checksum:'valid'}),storage,now:()=>t,picker:async()=>handle,withLock};
 // Browser feature detection is independent from injected lock implementation.
 Object.defineProperty(global.navigator,'locks',{value:{request:(_,fn)=>fn()},configurable:true});
 const service=create(options);await service.load();assert.equal(service.getState().folder,'');await service.choose();assert.equal(writes,1);assert.equal(service.getState().lastSuccess,t);
 t+=INTERVAL-1;await service.run();assert.equal(writes,1);t++;await service.run();assert.equal(writes,2);
 for(let i=0;i<5;i++){t+=INTERVAL;await service.run()}assert.equal(files.size,6);assert(files.has('my-important-file.json'));assert.equal(removed.length,2);
 const before=[...files.keys()];t+=INTERVAL;fail=true;await service.run();assert.deepEqual([...files.keys()],before);assert(service.getState().error.includes('Disk full'));fail=false;
 const restored=create(options);await restored.load();assert.equal(restored.getState().folder,'Backup');await Promise.all([restored.run(),service.run()]);assert.equal(writes,8,'two tabs produce only one due backup');
 handle.permission='prompt';t+=INTERVAL;await restored.run();assert.equal(writes,8);await restored.authorize();assert.equal(writes,9);
 const cancelled=create({...options,picker:async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'})}});await cancelled.load();assert.equal(await cancelled.choose(),false);assert.equal(saved.handle,handle);
 for(const value of files.values())if(value!=='keep')assert.deepEqual(JSON.parse(value).data,{test:1});
 console.log('PASS automatic backup interval, retention5, unrelated-file protection, failed write preservation, reload, permission, cancel, multi-tab lock');
})().catch(e=>{console.error(e);process.exitCode=1});
