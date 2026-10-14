/* Shogi rules and SFEN parsing. No dependencies. MIT license. */
(function (root) {
  'use strict';
  const NAMES = ['', '歩','香','桂','銀','金','角','飛','玉','と','成香','成桂','成銀','馬','龍'];
  const USI = ['', 'P','L','N','S','G','B','R','K'];
  const TOTAL = [0,18,4,4,4,4,2,2,2];
  const PROMOTE = [0,9,10,11,12,5,13,14,8];
  const UNPROMOTE = [0,1,2,3,4,5,6,7,8,1,2,3,4,6,7];
  const GOLDLIKE = new Set([5,9,10,11,12]);
  const PROMOTABLE = new Set([1,2,3,4,6,7]);
  const JAP_RANK = '一二三四五六七八九';
  const FW = '０１２３４５６７８９';
  const IDX = (x,y) => y*9+x;
  const owner = p => p > 0 ? 1 : p < 0 ? -1 : 0;
  const ownIndex = side => side===1 ? 0 : 1;
  const zone = (side, y) => side===1 ? y<=2 : y>=6;
  const last = (side, y) => side===1 ? y===0 : y===8;
  const invalidDrop = (type, side, y) => (type===1||type===2) && last(side,y) || (type===3 && (side===1 ? y<=1 : y>=7));
  function parseSfen(text) {
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    let line = lines.find(x => /(?:^|\s)(?:[1-9A-Za-z+]+\/){8}[1-9A-Za-z+]+\s+[bw]\s+/i.test(x)) || lines[0];
    if (!line) throw Error('SFENが入力されていません');
    line = line.replace(/^.*?(?=(?:[1-9A-Za-z+]+\/){8}[1-9A-Za-z+]+\s+[bw]\s+)/i,'');
    const p = line.split(/\s+/);
    if (p.length < 3) throw Error('SFENは「盤面 手番 持駒 手数」の形式で入力してください');
    if (p[4] === 'moves') throw Error('USIの「moves」付き局面には未対応です。指し手を反映したSFENを入力してください');
    if (p[1]!=='b' && p[1]!=='w') throw Error('SFENの手番は b または w で指定してください');
    const board = new Int8Array(81), rows=p[0].split('/');
    if (rows.length!==9) throw Error('盤面には9段必要です');
    const toType = ch => USI.indexOf(ch.toUpperCase());
    rows.forEach((r,y)=>{
      let x=0;
      for (let i=0;i<r.length;i++) {
        if (/[1-9]/.test(r[i])) {x+=Number(r[i]);continue;}
        let promoted=r[i]==='+';
        if (promoted) {i++;if (i>=r.length) throw Error(`${y+1}段目の成駒表記が不正です`);}
        let type=toType(r[i]);
        if (!type || (promoted&&!PROMOTABLE.has(type)) || x>=9) throw Error(`${y+1}段目に不正な駒があります`);
        if (promoted) type=PROMOTE[type];
        board[IDX(x++,y)]=(r[i]===r[i].toUpperCase()?1:-1)*type;
      }
      if (x!==9) throw Error(`${y+1}段目のマス数が9ではありません`);
    });
    const hands=[new Uint8Array(9),new Uint8Array(9)];
    if(p[2]!=='-') {
      const handRE=/(\d+)?([PLNSGBRplnsgbr])/g;
      let matched='', m;
      while ((m=handRE.exec(p[2]))) {
        const type=toType(m[2]), side=m[2]===m[2].toUpperCase()?1:-1;
        const count=Number(m[1]||1);
        if (!count || count>99 || hands[ownIndex(side)][type]+count>255) throw Error('持駒の枚数が不正です');
        hands[ownIndex(side)][type]+=count;
        matched+=m[0];
      }
      if(matched!==p[2]) throw Error('持駒欄の表記が不正です');
    }
    let kingB=-1, kingW=-1;
    for(let i=0;i<81;i++) if(board[i]===8) {if(kingB>=0) throw Error('先手の玉が複数あります'); kingB=i;}
      else if(board[i]===-8) {if(kingW>=0) throw Error('後手の玉が複数あります'); kingW=i;}
    const turn = p[1]==='b'?1:-1;
    const moveNo = p[3] == null?1:Number(p[3]);
    if (!Number.isInteger(moveNo)||moveNo<1) throw Error('手数欄が不正です');
    return {board,hands,kings:[kingB,kingW],turn,moveNo,source:`${p[0]} ${p[1]} ${p[2]} ${moveNo}`};
  }
  function toSfen(s) {
    const rows=[];
    for(let y=0;y<9;y++) {
      let row='', blanks=0;
      for(let x=0;x<9;x++) {
        const p=s.board[IDX(x,y)];
        if(!p){blanks++;continue;}
        if(blanks){row+=String(blanks);blanks=0;}
        const t=Math.abs(p),base=UNPROMOTE[t];
        if(!base || t>14)throw Error('盤面に不正な駒があります');
        const letter=p>0?USI[base]:USI[base].toLowerCase();
        row+=(base!==t?'+':'')+letter;
      }
      if(blanks)row+=String(blanks);
      rows.push(row);
    }
    let h='';
    for(const side of [1,-1])for(const t of [7,6,5,4,3,2,1]){
      const count=s.hands[ownIndex(side)][t];
      if(count)h+=(count>1?String(count):'')+(side===1?USI[t]:USI[t].toLowerCase());
    }
    return `${rows.join('/')} ${s.turn===1?'b':'w'} ${h||'-'} ${Number(s.moveNo)||1}`;
  }
  function cloneState(s){return {board:new Int8Array(s.board),hands:[new Uint8Array(s.hands[0]),new Uint8Array(s.hands[1])],kings:s.kings.slice(),turn:s.turn,moveNo:s.moveNo,source:s.source};}
  function fillDefenderHand(state) {
    const s=cloneState(state), attacker=ownIndex(s.turn), defender=attacker^1;
    const pool=new Int16Array(TOTAL);
    for(const piece of s.board) if(piece) pool[UNPROMOTE[Math.abs(piece)]]--;
    for(let type=1;type<=7;type++) {
      pool[type]-=s.hands[attacker][type];
      if(pool[type]<0) throw Error(`${NAMES[type]}が通常の駒の総数を超えています`);
      s.hands[defender][type]=pool[type];
    }
    if(pool[8]<0) throw Error('玉の枚数が不正です');
    return s;
  }
  function isAttacked(s, square, side) {
    if(square<0) return false;
    const board=s.board, cx=square%9, cy=(square/9)|0;
    // Scan first blocker in all 8 rays.
    for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
      if(dx===0 && dy===0)continue;
      let x=cx+dx,y=cy+dy,d=1;
      while(x>=0&&x<9&&y>=0&&y<9) {
        const piece=board[IDX(x,y)];
        if(piece) {
          if(owner(piece)===side) {
            const t=Math.abs(piece), forward=dy*side;
            const orth=(dx===0||dy===0), diag=dx!==0&&dy!==0;
            if ((orth&&(t===7||t===14)) || (diag&&(t===6||t===13)) || (dx===0&&forward>0&&t===2)) return true;
            if(d===1) {
              if(t===8) return true;
              if(t===1 && dx===0&&forward===1) return true;
              if(t===4 && ((forward===1&&Math.abs(dx)===1)||(forward===-1&&Math.abs(dx)===1)||(forward===1&&dx===0))) return true;
              if(GOLDLIKE.has(t) && ((forward===1)||(forward===-1&&dx===0)||(forward===0&&Math.abs(dx)===1))) return true;
              if(t===13 && orth || t===14 && diag) return true;
            }
          }
          break;
        }
        x+=dx;y+=dy;d++;
      }
    }
    const ny=cy+2*side;
    if(ny>=0&&ny<9) for(const dx of [-1,1]) {
      const nx=cx+dx;
      if(nx>=0&&nx<9 && board[IDX(nx,ny)]===3*side) return true;
    }
    return false;
  }
  function inCheck(s,side){return isAttacked(s,s.kings[ownIndex(side)],-side);}
  // Direction vectors are expressed in absolute board coordinates after sign normalization.
  const STEPS = {
    1:[[0,-1]], 3:[[-1,-2],[1,-2]],
    4:[[-1,-1],[0,-1],[1,-1],[-1,1],[1,1]],
    5:[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[0,1]],
    8:[[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]],
    13:[[0,-1],[0,1],[-1,0],[1,0]],
    14:[[-1,-1],[1,-1],[-1,1],[1,1]]
  };
  const RAYS = {2:[[0,-1]],6:[[-1,-1],[1,-1],[-1,1],[1,1]],7:[[0,-1],[0,1],[-1,0],[1,0]]};
  // A faster directional generator stops sliding paths at blockers.
  function forPieceDestinations(s,from,side,type,visit) {
    const x=from%9,y=(from/9)|0, board=s.board;
    const st=STEPS[GOLDLIKE.has(type)?5:type]||[];
    for(const [dx,dy] of st) {
      const a=x+dx,b=y+dy*side;
      if(a>=0&&a<9&&b>=0&&b<9){const to=IDX(a,b);if(owner(board[to])!==side && Math.abs(board[to])!==8) visit(to);}
    }
    const rt=type===13?6:type===14?7:type;
    for(const [dx,dy] of (RAYS[rt]||[])){
      let a=x+dx,b=y+dy*side;
      while(a>=0&&a<9&&b>=0&&b<9) {
        const to=IDX(a,b), p=board[to];
        if(owner(p)===side || Math.abs(p)===8)break;
        visit(to);
        if(p)break;
        a+=dx;b+=dy*side;
      }
    }
  }
  function addMoves(out,from,to,type,side) {
    const y=to/9|0;
    if(PROMOTABLE.has(type) && (zone(side,from/9|0)||zone(side,y))) {
      if(!invalidDrop(type,side,y)) out.push({from,to,promote:false,piece:type});
      out.push({from,to,promote:true,piece:type});
    } else if(!invalidDrop(type,side,y)) out.push({from,to,promote:false,piece:type});
  }
  function hasPawnOnFile(s,side,file) {
    for(let y=0;y<9;y++) if(s.board[IDX(file,y)]===side) return true;
    return false;
  }
  // Compute checking pieces, and all squares that can interpose a single line check.
  function checkerInfo(s,attacker) {
    const king=s.kings[ownIndex(-attacker)];
    if(king<0) return {count:0,targets:null,dropTargets:[]};
    const targets=new Uint8Array(81),dropTargets=[];
    let count=0;
    const kx=king%9,ky=king/9|0;
    // Determine checkers by examining piece attacks directly. Called once per defense node.
    for(let i=0;i<81;i++) if(owner(s.board[i])===attacker && attacksFrom(s,i,king)) {
      count++; targets[i]=1;
      const dx=Math.sign(kx-i%9),dy=Math.sign(ky-(i/9|0));
      const d=Math.max(Math.abs(kx-i%9),Math.abs(ky-(i/9|0)));
      if(d>1 && (dx===0||dy===0||Math.abs(kx-i%9)===Math.abs(ky-(i/9|0)))) {
        for(let step=1;step<d;step++) {const sq=IDX(i%9+dx*step,(i/9|0)+dy*step);targets[sq]=1;dropTargets.push(sq);}
      }
    }
    if(count>1) return {count,targets:new Uint8Array(81),dropTargets:[]};
    return {count,targets,dropTargets};
  }
  function attacksFrom(s,from,to) {
    const p=s.board[from]; if(!p) return false;
    const side=owner(p), type=Math.abs(p), x=from%9,y=from/9|0;
    const dx=to%9-x, dy=(to/9|0)-y;
    const rx=dx,ry=dy*side;
    if(type===1)return rx===0&&ry===-1;
    if(type===3)return Math.abs(rx)===1&&ry===-2;
    if(type===4)return (ry===-1&&Math.abs(rx)<=1)||(ry===1&&Math.abs(rx)===1);
    if(GOLDLIKE.has(type))return (ry===-1&&Math.abs(rx)<=1)||(ry===0&&Math.abs(rx)===1)||(ry===1&&rx===0);
    if(type===8)return Math.max(Math.abs(rx),Math.abs(ry))===1;
    if(type===13&&Math.abs(rx)+Math.abs(ry)===1)return true;
    if(type===14&&Math.abs(rx)===1&&Math.abs(ry)===1)return true;
    const bishop=(type===6||type===13)&&Math.abs(rx)===Math.abs(ry)&&rx!==0;
    const rook=(type===7||type===14)&&(rx===0||ry===0)&&(rx!==0||ry!==0);
    const lance=type===2&&rx===0&&ry<0;
    if(!(bishop||rook||lance))return false;
    const stepX=Math.sign(dx),stepY=Math.sign(dy);
    for(let a=x+stepX,b=y+stepY;a!==to%9||b!==(to/9|0);a+=stepX,b+=stepY) if(s.board[IDX(a,b)])return false;
    return true;
  }
  function makeMove(s,m,side) {
    const board=s.board, captured=board[m.to], was=m.from===-1?0:board[m.from];
    if(m.from===-1) s.hands[ownIndex(side)][m.piece]--;
    else board[m.from]=0;
    if(captured) s.hands[ownIndex(side)][UNPROMOTE[Math.abs(captured)]]++;
    board[m.to]=side*(m.promote?PROMOTE[m.piece]:m.piece);
    if(m.piece===8)s.kings[ownIndex(side)]=m.to;
    return {captured,was};
  }
  function undoMove(s,m,side,undo) {
    s.board[m.to]=undo.captured;
    if(undo.captured)s.hands[ownIndex(side)][UNPROMOTE[Math.abs(undo.captured)]]--;
    if(m.from===-1)s.hands[ownIndex(side)][m.piece]++;
    else s.board[m.from]=undo.was;
    if(m.piece===8)s.kings[ownIndex(side)]=m.from;
  }
  function generateChecks(s,attacker) {
    const out=[], board=s.board, king=s.kings[ownIndex(-attacker)];
    if(king<0) return out;
    for(let from=0;from<81;from++) if(owner(board[from])===attacker) {
      const type=Math.abs(board[from]), poss=[];
      forPieceDestinations(s,from,attacker,type,to=>addMoves(poss,from,to,type,attacker));
      for(const m of poss) {
        const u=makeMove(s,m,attacker);
        if(!inCheck(s,attacker)&&isAttacked(s,king,attacker))out.push(m);
        undoMove(s,m,attacker,u);
      }
    }
    const hand=s.hands[ownIndex(attacker)];
    for(let to=0;to<81;to++) if(!board[to]) {
      const y=to/9|0,x=to%9;
      for(let type=1;type<=7;type++) if(hand[type]&&!invalidDrop(type,attacker,y) && !(type===1&&hasPawnOnFile(s,attacker,x))) {
        // Placing a piece cannot create a discovered check: test the drop piece first.
        board[to]=attacker*type;
        const givesCheck=attacksFrom(s,to,king);
        board[to]=0;
        if(!givesCheck)continue;
        const m={from:-1,to,promote:false,piece:type},u=makeMove(s,m,attacker);
        if(!inCheck(s,attacker))out.push(m);
        undoMove(s,m,attacker,u);
      }
    }
    // Checking drops first, then moves: hand placements typically have strong forcing effects.
    out.sort((a,b)=> (a.from===-1?-1:0) - (b.from===-1?-1:0));
    return out;
  }
  function generateDefenses(s,defender,oneOnly=false) {
    const attacker=-defender, king=s.kings[ownIndex(defender)];
    if(king<0)return [];
    if(!isAttacked(s,king,attacker)) return [];
    const {count,targets,dropTargets}=checkerInfo(s,attacker),out=[], board=s.board;
    const tryMove=m=>{
      const u=makeMove(s,m,defender);
      const good=!inCheck(s,defender);
      undoMove(s,m,defender,u);
      if(good)out.push(m);
      return good&&oneOnly;
    };
    // King moves always legal to consider, including capture of checking piece.
    const kings=[];
    forPieceDestinations(s,king,defender,8,to=>kings.push({from:king,to,promote:false,piece:8}));
    for(const m of kings)if(tryMove(m))return out;
    if(count>1)return out;
    for(let from=0;from<81;from++)if(owner(board[from])===defender && from!==king){
      const type=Math.abs(board[from]); const poss=[];
      forPieceDestinations(s,from,defender,type,to=>{if(targets[to])addMoves(poss,from,to,type,defender);});
      for(const m of poss)if(tryMove(m))return out;
    }
    const hand=s.hands[ownIndex(defender)];
    for(const to of dropTargets) if(!board[to]) {
      const y=to/9|0,x=to%9;
      for(let type=1;type<=7;type++)if(hand[type]&&!invalidDrop(type,defender,y)&&!(type===1&&hasPawnOnFile(s,defender,x))){
        if(tryMove({from:-1,to,promote:false,piece:type}))return out;
      }
    }
    return out;
  }
  function isPawnDropMate(s,move,attacker){
    if(move.from!==-1||move.piece!==1)return false;
    const u=makeMove(s,move,attacker);
    const mate=isAttacked(s,s.kings[ownIndex(-attacker)],attacker) && generateDefenses(s,-attacker,true).length===0;
    undoMove(s,move,attacker,u);
    return mate;
  }
  function squareUsi(sq){return `${9-sq%9}${'abcdefghi'[sq/9|0]}`;}
  function usiMove(m){return m.from===-1?`${USI[m.piece]}*${squareUsi(m.to)}`:`${squareUsi(m.from)}${squareUsi(m.to)}${m.promote?'+':''}`;}
  function japaneseMove(m,side){
    const xy=m.to; const target=`${FW[9-xy%9]}${JAP_RANK[xy/9|0]}`;
    const type=NAMES[m.piece];
    return `${side===1?'▲':'△'}${target}${type}${m.from===-1?'打':m.promote?'成':''}${m.from<0?'':`(${9-m.from%9}${m.from/9+1|0})`}`;
  }
  function handLabel(h){return [7,6,5,4,3,2,1].filter(t=>h[t]).map(t=>`${NAMES[t]}${h[t]>1?h[t]:''}`).join(' ')||'なし';}
  const api={NAMES,USI,TOTAL,UNPROMOTE,PROMOTE,parseSfen,toSfen,cloneState,fillDefenderHand,isAttacked,inCheck,checkerInfo,attacksFrom,makeMove,undoMove,generateChecks,generateDefenses,isPawnDropMate,usiMove,japaneseMove,handLabel,ownIndex};
  root.Shogi=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
