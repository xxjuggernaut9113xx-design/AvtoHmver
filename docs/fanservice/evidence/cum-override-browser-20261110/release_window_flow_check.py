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
    res=pg.evaluate("""()=>{
      const out={},snap=()=>{const f=run.state.cardFlow;return f?{gen:f.generation,pool:f.pool,travel:f.travel,assigned:f.assigned,len:f.pattern.length}:null;};
      run.player.isAllowedToCum=true;
      objectiveEvents([{type:'release-window-opened'}]);
      out.after_window_open=snap();
      const seq=[];
      for(let k=0;k<4;k++){const f=run.state.cardFlow,span=(f.queue.at(-1)?.TargetHitTime||0)+5;objectiveEvents(run.advance(span));seq.push(snap());}
      out.after_card_ends=seq;
      run.player.isAllowedToCum=false;
      const f=run.state.cardFlow;objectiveEvents(run.advance((f.queue.at(-1)?.TargetHitTime||0)+5));out.after_window_closed=snap();
      return out;}""")
    print(json.dumps(res,indent=1)); print('errors',errs[:5])
    b.close()
