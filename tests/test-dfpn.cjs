const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const E=require('../engine.js');
const ROOT=path.join(__dirname,'..');
function run(file,sfen,{depth=9,defenderAll=true,seconds=10,maxNodes=300000}={}){
 const ctx=vm.createContext({console,Date,Set,Map,Int8Array,Uint8Array,Int16Array,Array,Math,Number,Error,String});
 ctx.self=ctx;
 ctx.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(ROOT,name),'utf8'),ctx,{filename:name});
 vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),ctx,{filename:file});
 let result;
 ctx.postMessage=m=>{if(m.type==='done'||m.type==='error')result=m;};
 ctx.onmessage({data:{type:'solve',sfen,depth,defenderAll,seconds,maxNodes}});
 return result;
}
const longer='9/9/3pp4/+r2k1p3/2L1+p4/2+R6/B8/B8/9 b 4g4s4n3l14p 1';
const short='8k/6G2/7G1/9/9/9/9/9/9 b R 1';
test('SFEN serializer round trips all pieces, hands, turn and move count',()=>{
 for(const sfen of [short,longer,'4k4/9/3+P5/3+b2+R2/9/9/9/9/4K4 w 3S2pR 39','9/9/9/9/9/9/9/9/9 b - 1']){
  const s=E.parseSfen(sfen), encoded=E.toSfen(s), b=E.parseSfen(encoded);
  assert.deepEqual([...b.board],[...s.board]);assert.deepEqual(b.hands.map(h=>[...h]),s.hands.map(h=>[...h]));
  assert.equal(b.turn,s.turn);assert.equal(b.moveNo,s.moveNo);
 }
});
test('long-search DFPN solves a verified 9-ply puzzle with 201-ply search horizon',()=>{
 const result=run('dfpn-worker.js',longer,{depth:201});
 assert.equal(result.type,'done');assert.equal(result.solved,true,result.message);
 assert.equal(result.plies,9);assert.equal(result.pv.length,9);
 assert.equal(result.algorithm,'dfpn');assert.equal(result.depth,201);
 const s=E.fillDefenderHand(E.parseSfen(longer));let side=s.turn;
 for(let i=0;i<result.pv.length;i++){
  const m=result.pv[i],legal=(i%2===0?E.generateChecks(s,side):E.generateDefenses(s,side));
  assert.ok(legal.some(x=>E.usiMove(x)===E.usiMove(m)),`ply ${i+1} ${E.usiMove(m)} invalid`);
  E.makeMove(s,m,side);side=-side;
 }
 assert.equal(E.generateDefenses(s,side).length,0);
});
test('single-ply solution is found at 501-ply horizon without repeated depth traversal',()=>{
 const result=run('dfpn-worker.js',short,{depth:501});
 assert.equal(result.solved,true);assert.equal(result.plies,1);
 assert.ok(result.nodes<100);
});
test('no forced check is not falsely reported as mate',()=>{
 const result=run('dfpn-worker.js','8k/9/9/9/9/9/9/9/9 b - 1',{depth:101,defenderAll:false});
 assert.equal(result.type,'done');assert.equal(result.solved,false);
});
test('depth 5 proof and refutation agree with iterative baseline for sample positions',()=>{
 // Fixed positions avoid a random/flaky fixture and exercise double checks, promotions, defenders.
 const positions=[
  short,'8k/6G2/7G1/9/9/9/9/9/9 b P 1','4k4/9/3R5/9/9/9/9/9/9 b G 1',
  '4k4/3p5/9/9/4R4/9/9/9/9 b N 1','9/4k4/9/3R5/9/9/9/9/9 b G 1',
  '8k/9/8R/9/9/9/9/9/9 b G 1','8k/6G2/9/9/9/9/9/9/9 b L 1'
 ];
 for(const sf of positions){
  const a=run('dfpn-worker.js',sf,{depth:5,defenderAll:false,seconds:5});
  const b=run('solver-worker.js',sf,{depth:5,defenderAll:false,seconds:5});
  assert.equal(a.type,'done',`DFPN ${sf}: ${a.message}`);
  assert.equal(b.type,'done',`DFS ${sf}: ${b.message}`);
  assert.equal(a.solved,b.solved,`Mismatch: ${sf}`);
 }
});
