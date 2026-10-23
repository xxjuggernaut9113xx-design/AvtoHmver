const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Tower}=require('../static/fanservice/tower');
const catalog=require('../static/fanservice/data/modes.json');
test('mobile Tower draft lifecycle matches 256 native reconstruction fixtures',()=>{
 const {cases}=JSON.parse(fs.readFileSync(require.resolve('./fixtures/fanservice/native-tower-contract.json'),'utf8').replace(/^\uFEFF/,''));
 assert.equal(cases.length,256);let tower,key;
 for(const row of cases){const next=row.seed+':'+row.rounds;if(next!==key){tower=new Tower(catalog,row.rounds,row.seed);key=next;}
  assert.deepEqual(tower.options,row.options,`${key} round ${row.round}`);
  tower.select((row.round-1)%3);tower.complete(true,{seconds:120,edges:(row.round-1)%3,defensive:(row.round-1)%2});if(tower.phase==='shop')tower.continue();
 }
});
test('mobile Tower rewards and random cursor match 216 native inventory-aware fixtures',()=>{
 const {Inventory,rewards}=require('../static/fanservice/inventory'),{Random}=require('../static/fanservice/tower');
 const {reward_cases}=JSON.parse(fs.readFileSync(require.resolve('./fixtures/fanservice/native-tower-contract.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(reward_cases.length,216);
 for(const row of reward_cases){const inventory=new Inventory();if(row.preset>0)for(let type=1;type<=13;type++)if(type!==2&&type!==8){inventory.unlock(type);inventory.state(type).level=row.preset===2?5:1;}
  const random=new Random(row.seed),actual=rewards({tier:row.tier,lane:row.lane,baseCoins:100,baseSuccuCoins:10,final:row.tier===6,unlockableModifiers:[0,1,13,21]},inventory,row.preset===2?[0,13]:[],random);
  assert.deepEqual(actual,row.rewards,JSON.stringify(row));assert.equal(random.seed,row.final_seed);
 }
});
