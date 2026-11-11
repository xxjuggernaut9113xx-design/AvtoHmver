import json,sys
from playwright.sync_api import sync_playwright
URL='http://127.0.0.1:8765/fanservice/'
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',args=['--no-sandbox'])
    ctx=b.new_context(service_workers='block'); pg=ctx.new_page()
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append('console:'+m.text) if m.type=='error' else None)
    pg.goto(URL+'index.html'); pg.wait_for_function('window.FanserviceStore&&window.FanserviceModel')
    info=pg.evaluate('''async()=>{
      const S=FanserviceStore,M=FanserviceModel,pools=['slow','medium','fast','succubus','cum','ass','boobs'];
      const mk=async(c)=>{const cv=document.createElement('canvas');cv.width=cv.height=8;const x=cv.getContext('2d');x.fillStyle=c;x.fillRect(0,0,8,8);return new Promise(r=>cv.toBlob(r,'image/png'));};
      const ids=[];let i=0;
      for(const pool of pools){const blob=await mk('#'+(100+i*20).toString(16).padStart(2,'0')+'8080');i++;const f=new File([blob],pool+'.png',{type:'image/png'});const r=await S.importFiles([f],[pool]);ids.push(r[0].id);}
      const library='device:'+S.device;
      let profile=M.fresh();
      const manifest={library_id:library,media:[{id:'x'}]};
      profile=M.change(profile,{action:'create',pack:{id:'custom:t1',name:'T',description:'',library_id:library,device_id:S.device,unlock_cost:0,selection:{ids:[],rules:[],local_ids:ids}},manifest});
      profile=M.change(profile,{action:'enable',id:'custom:t1',enabled:true,manifest});
      localStorage.setItem('fanservice-profile-v1:'+library,JSON.stringify(profile));
      return {library,ids};}''')
    print('seeded',info['library'][:12])
    pg.goto(URL+'play.html'); 
    try: pg.wait_for_function("typeof run!=='undefined'&&run&&!document.getElementById('start').disabled",timeout=15000)
    except Exception as e: print('NOT READY',e, errs[:5], pg.inner_text('body')[:300]); b.close(); sys.exit(1)
    print('ready; mode',pg.evaluate('run.config.mode'))
    pg.click('#start'); pg.wait_for_function('started===true',timeout=10000)
    res=pg.evaluate('''()=>{
      const bank=%s,out={};
      const snap=()=>{const f=run.state.cardFlow;return f?{pool:f.pool,travel:f.travel,assigned:f.assigned,pattern:f.pattern}:null;};
      out.due0=run.cumOverrideDue();
      run.player.isAllowedToCum=true; out.due1=run.cumOverrideDue();
      draw(undefined,{force:true}); out.auto_allowed=snap();
      draw('cum',{force:true}); out.explicit_cum=snap();
      run.player.isAllowedToCum=false; draw(undefined,{force:true}); out.auto_normal=snap();
      run.player.isAllowedToCum=true; run.state.edge={phase:'sequence'}; out.due_edge=run.cumOverrideDue(); run.state.edge=null;
      out.bank_match=(()=>{run.player.isAllowedToCum=true;let ok=0;for(let i=0;i<30;i++){draw(undefined,{force:true});const f=run.state.cardFlow;if(f.pool==='cum'&&bank.some(r=>JSON.stringify(r)===JSON.stringify(f.pattern)))ok++;}return ok;})();
      return out;}'''%json.dumps([[1],[1,1,1,1,.5,.5,.5,.5,.5,.5],[1,1,.5,.5,.5,.5,-1],[.5]*8+[1.5],[1,1,1,1.5]]))
    print(json.dumps(res,indent=1)); print('errors',errs[:5])
    b.close()
