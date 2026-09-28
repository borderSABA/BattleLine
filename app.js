'use strict';
const GAME_ID='battle-line', GAME_NAME='バトルライン', MAX_PLAYERS=2, APP_VERSION='v0.4.2';
const WORKER_ORIGIN=String(window.BATTLE_LINE_WORKER_ORIGIN||'').replace(/\/$/,'');
const COMMON_PLAYER_NAME_KEY='boardgamePlayerName', ROOM_IDS=['room1','room2','room3','room4'];
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let ws=null,currentRoomId=null,currentPlayerName='',state=null,selectedCard=null,tacticTarget=null,resultDismissed=false,reconnectTimer=null,commonNameSavedForSession=null,actionSeq=0;
function commonSavedName(){return String(localStorage.getItem(COMMON_PLAYER_NAME_KEY)||'').trim().slice(0,32)}
function saveCommonNameOnActualStart(n){n=String(n||'').trim().slice(0,32);if(n)localStorage.setItem(COMMON_PLAYER_NAME_KEY,n)}
function tokenKey(r){return `${GAME_ID}-online-token-${r}`}; function getToken(r){let t=localStorage.getItem(tokenKey(r));if(!t){t=crypto.randomUUID().replace(/-/g,'');localStorage.setItem(tokenKey(r),t)}return t}
function newActionId(p='op'){actionSeq=(actionSeq+1)%1e6;return[p,Date.now(),actionSeq,Math.random().toString(36).slice(2,8)].join('-')}
function toast(m){const e=$('#toast');e.textContent=m;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}
function screen(id){$$('.screen').forEach(x=>x.classList.remove('active'));$(id).classList.add('active')}
function api(path,opt){if(WORKER_ORIGIN.includes('CHANGE-ME'))return Promise.reject(new Error('config.js にWorker URLを設定してください'));return fetch(WORKER_ORIGIN+path,opt)}
async function loadRooms(){try{const q=new URLSearchParams();ROOM_IDS.forEach((id,i)=>q.set('token'+(i+1),localStorage.getItem(tokenKey(id))||''));const r=await api('/rooms?'+q.toString(),{cache:'no-store'}),d=await r.json();renderRooms(d.rooms||[])}catch(e){renderRooms([]);toast(e.message)}}
function renderRooms(rooms){$('#rooms').innerHTML=ROOM_IDS.map((id,i)=>{const r=rooms.find(x=>x.roomId===id)||{players:[],status:'lobby'};const names=(r.players||[]).map(x=>x.name).join(' / ')||'なし';return `<article class="room"><h2>ROOM ${i+1}</h2><div class="status">${r.status==='playing'?'ゲーム中':r.status==='finished'?'終了':'待機中'}</div><b>${(r.players||[]).length} / 2人</b><div class="players">参加者：${esc(names)}</div><button class="join" data-room="${id}">${r.reconnectable?'再接続':'参加する'}</button><button class="reset" data-reset="${id}">初期化</button></article>`}).join('');$$('[data-room]').forEach(b=>b.onclick=()=>joinRoom(b.dataset.room));$$('[data-reset]').forEach(b=>b.onclick=()=>resetRoom(b.dataset.reset))}
async function resetRoom(id){if(!confirm(`ROOM ${ROOM_IDS.indexOf(id)+1} を初期化しますか？`))return;try{const r=await api(`/reset-empty?roomId=${id}`,{method:'POST'}),d=await r.json();if(!r.ok)throw Error(d.error||'初期化できません');loadRooms()}catch(e){toast(e.message)}}
async function joinRoom(id){const name=$('#name').value.trim().slice(0,32);if(!name)return toast('プレイヤー名を入力してください');const token=getToken(id);try{const r=await api(`/join-check?roomId=${id}&name=${encodeURIComponent(name)}&token=${token}`,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'ROOMへ参加できません');currentRoomId=id;currentPlayerName=name;localStorage.setItem(`${GAME_ID}-online-room`,id);localStorage.setItem(`${GAME_ID}-online-active-name`,name);connect()}catch(e){toast(e.message)}}
function connect(){if(ws)try{ws.close()}catch{};const u=new URL(WORKER_ORIGIN);u.protocol=u.protocol==='https:'?'wss:':'ws:';u.pathname='/ws';u.searchParams.set('roomId',currentRoomId);u.searchParams.set('name',currentPlayerName);u.searchParams.set('token',getToken(currentRoomId));ws=new WebSocket(u);ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='state'){state=m.state;onState()}else if(m.type==='error')toast(m.error)};ws.onclose=()=>{if(currentRoomId)scheduleReconnect()};ws.onerror=()=>{} }
function scheduleReconnect(){clearTimeout(reconnectTimer);reconnectTimer=setTimeout(()=>{if(currentRoomId&&(!ws||ws.readyState!==1))connect()},1800)}
function send(type,data={}){if(!ws||ws.readyState!==1)return toast('再接続中です');ws.send(JSON.stringify({type,actionId:newActionId(type),...data}))}
function onState(){
 const mine=me();
 if(!mine||state.status!=='playing'||state.turnPlayerId!==mine.id||state.phase!=='play'){
   selectedCard=null;tacticTarget=null;
 }
 if(state.status==='playing'&&state.gameSessionId&&commonNameSavedForSession!==state.gameSessionId){saveCommonNameOnActualStart(currentPlayerName);commonNameSavedForSession=state.gameSessionId}if(state.status==='lobby')renderLobby();else renderGame();}
function me(){return state?.players?.find(p=>p.token===getToken(currentRoomId))} function opp(){const m=me();return state?.players?.find(p=>p.id!==m?.id)}
function renderLobby(){screen('#lobby');$('#lobbyRoom').textContent=`ROOM ${ROOM_IDS.indexOf(currentRoomId)+1}`;$('#seats').innerHTML=(state.players||[]).map((p,i)=>`<p><b>${i+1}.</b> ${esc(p.name)} ${p.cpu?'（CPU Lv'+p.cpu+'）':''}${p.id===state.hostId?' ★HOST':''}</p>`).join('')||'<p>待機中</p>';const host=me()?.id===state.hostId;$('#hostSettings').style.opacity=host?'1':'.55';$('#startBtn').style.display=host?'block':'none';for(const [id,key] of [['tactics','tactics'],['claimRule','claimRule'],['first','first'],['cpu','cpuLevel']]){$('#'+id).value=String(state.settings?.[key]??(id==='tactics'?'true':id==='claimRule'?'normal':id==='first'?'random':'0'));$('#'+id).disabled=!host} }
function cardHtml(c,hand=false){if(!c)return '<div class="slot"></div>';if(c.kind==='troop')return `<div class="card ${c.color}" data-card="${c.id}"><span>${colorMark(c.color)}</span><b>${c.value}</b></div>`;return `<div class="card tactic" data-card="${c.id}" title="${esc(c.text||'')}"><small>戦術</small><b>${esc(c.name)}</b></div>`}
function colorMark(c){return ({red:'赤',blue:'青',green:'緑',yellow:'黄',purple:'紫',orange:'橙'})[c]||c}
function renderGame(){screen('#game');if(state.status!=='finished')resultDismissed=false;const m=me(),o=opp();if(!m)return;$('#oppInfo').innerHTML=`<b>${esc(o?.name||'CPU')}</b>　手札 ${o?.handCount??0}　⚑${o?.flags??0}`;$('#myInfo').innerHTML=`<b>${esc(m.name)}</b>　⚑${m.flags||0}　使用戦術 ${m.tacticsUsed||0}`;$('#phaseText').textContent=phaseLabel();
const myTurn=state.turnPlayerId===m.id;
$('#turnGuide').innerHTML=turnGuideHtml(myTurn);
$('#finishedActions').classList.toggle('hidden',state.status!=='finished');$('#troopDeck b').textContent=state.troopDeckCount;$('#tacticDeck b').textContent=state.tacticDeckCount;$('#tacticDeck').style.display=state.settings.tactics?'block':'none';$('#troopDeck').classList.toggle('ready',myTurn&&state.phase==='draw');$('#tacticDeck').classList.toggle('ready',myTurn&&state.phase==='draw');renderBattle();$('#hand').innerHTML=(m.hand||[]).map(cardHtml).join('');$$('#hand .card').forEach(el=>{el.onclick=()=>selectCard(el.dataset.card);if(el.dataset.card===selectedCard)el.classList.add('selected')});if(state.status==='finished'&&!resultDismissed)showResult()}
function phaseLabel(){const m=me(),turn=state.turnPlayerId===m?.id?'あなた':'相手';if(state.status==='finished')return 'ゲーム終了';return `${turn}の手番 / ${state.phase==='play'?'カード配置':state.phase==='draw'?'カードを引く':'処理中'}`}
function turnGuideHtml(myTurn){
 if(state.status==='finished')return '<b>対戦終了</b><span>盤面を確認できます。下のボタンからリザルト表示・ロビー復帰ができます。</span>';
 if(!myTurn)return `<b>相手のターン</b><span>${state.phase==='play'?'カードを配置しています':'カードを引いています'}</span>`;
 if(tacticTarget)return '<b>戦術対象を選択中</b><span>盤面の光っている対象を選択してください。</span>'; if(state.phase==='draw')return '<b>③ カードを1枚引いてください</b><span>部隊山札 または 戦術山札 を選ぶとターン終了です。</span>';
 return '<b>① 獲得できる旗を確認　→　② 手札を1枚選んで戦線へ配置</b><span>配置後は山札から1枚引きます。</span>';
}
function renderBattle(){
 const m=me();
 $('#battlefield').innerHTML=state.flags.map((f,i)=>{
  const mine=f.sides[m.seat]||[],other=f.sides[1-m.seat]||[];
  const top=m.seat===0?other:mine,bottom=m.seat===0?mine:other;
  const topSeat=m.seat===0?1:0,bottomSeat=m.seat===0?0:1;
  const owner=f.ownerId===m.id?'mine':f.ownerId?'opp':'';
  const boardCards=(arr,seat)=>arr.map(c=>boardCardHtml(c,i,seat)).join('');
  return `<div class="lane" data-lane="${i}">
   <div class="formation">${boardCards(top,topSeat)}${slots(f,top.length)}</div>
   <div class="flag ${owner} ${f.claimableByMe&&!tacticTarget?'claimable':''}" data-claim="${i}">⚑ ${i+1}<small>${f.effect?'<br>'+esc(f.effect):''}</small><span class="role">${esc(f.summary||'')}</span></div>
   <div class="formation">${boardCards(bottom,bottomSeat)}${slots(f,bottom.length)}</div>
  </div>`}).join('');
 $('#flagNav').innerHTML=state.flags.map((f,i)=>`<button class="${f.ownerId===m.id?'mine':f.ownerId?'opp':''}" data-nav="${i}">${i+1}</button>`).join('');
 $$('[data-nav]').forEach(b=>b.onclick=()=>$$('.lane')[+b.dataset.nav].scrollIntoView({behavior:'smooth',inline:'center',block:'nearest'}));
 if(tacticTarget){
   markTacticTargets();
 }else{
   $$('.lane').forEach(l=>l.onclick=e=>{if(e.target.closest('.flag.claimable')||e.target.closest('.board-card'))return;if(selectedCard)playSelected(+l.dataset.lane)});
   $$('.flag.claimable').forEach(f=>f.onclick=e=>{e.stopPropagation();send('claim',{flag:+f.dataset.claim})});
 }
}
function boardCardHtml(c,fi,seat){
 const attrs=`data-board-fi="${fi}" data-board-seat="${seat}" data-board-card="${esc(c.id)}"`;
 if(c.kind==='troop')return `<div class="card board-card ${c.color}" ${attrs}><span>${colorMark(c.color)}</span><b>${c.value}</b></div>`;
 return `<div class="card board-card tactic" ${attrs} title="${esc(c.text||'')}"><small>戦術</small><b>${esc(c.name)}</b></div>`;
}
function slots(f,n){const max=f.mud?4:3;return Array.from({length:Math.max(0,max-n)},()=>'<div class="slot"></div>').join('')}
function selectCard(id){
 if(state.turnPlayerId!==me()?.id||state.phase!=='play'){selectedCard=null;tacticTarget=null;return toast('今はカードを出せません')}
 tacticTarget=null;selectedCard=selectedCard===id?null:id;renderGame()
}
function playSelected(flag){
 const c=me().hand.find(x=>x.id===selectedCard);if(!c)return;
 if(c.kind==='tactic'&&['deserter','redeploy','traitor'].includes(c.code)){beginTacticTarget(c,flag);return}
 send('play',{cardId:selectedCard,flag});selectedCard=null;tacticTarget=null;
}
function beginTacticTarget(c,flag){
 tacticTarget={cardId:c.id,code:c.code,targetFlag:flag};
 renderGame();
 toast(`${c.name}：盤面の光っている対象を選択してください`);
}
function cancelTacticTarget(){tacticTarget=null;renderGame()}
function validTacticTarget(fi,seat,c){
 if(!tacticTarget||state.flags[fi].ownerId)return false;
 if(tacticTarget.code==='deserter')return seat!==me().seat;
 if(tacticTarget.code==='redeploy')return seat===me().seat;
 if(tacticTarget.code==='traitor')return seat!==me().seat&&c.kind==='troop';
 return false;
}
function markTacticTargets(){
 $$('.board-card').forEach(el=>{
  const fi=+el.dataset.boardFi,seat=+el.dataset.boardSeat,id=el.dataset.boardCard;
  const c=state.flags[fi].sides[seat].find(x=>x.id===id);
  if(c&&validTacticTarget(fi,seat,c)){
   el.classList.add('tactic-target');
   el.onclick=e=>{e.stopPropagation();confirmTacticTarget(fi,id,c)};
  }else el.classList.add('tactic-dim');
 });
 $('#turnGuide').innerHTML=`<b>戦術対象を選択中</b><span>光っているカードを選択してください。 <button id="cancelTacticBtn">キャンセル</button></span>`;
 $('#cancelTacticBtn').onclick=cancelTacticTarget;
}
function confirmTacticTarget(sourceFlag,targetCardId,c){
 const tc=me().hand.find(x=>x.id===tacticTarget?.cardId);if(!tc)return cancelTacticTarget();
 const label=`旗${sourceFlag+1}の「${cardLabel(c)}」`;
 if(!confirm(`${tc.name}を${label}に使用しますか？`))return;
 const payload={cardId:tc.id,flag:tacticTarget.targetFlag,sourceFlag,targetCardId};
 tacticTarget=null;selectedCard=null;send('play',payload);
}
function cardLabel(c){return c.kind==='troop'?`${colorMark(c.color)}${c.value}`:c.name}
function modal(h){$('#modalBody').innerHTML=h;$('#modal').classList.remove('hidden')} function closeModal(){$('#modal').classList.add('hidden')}
function showResult(force=false){
 if(!force&&!$('#modal').classList.contains('hidden'))return;
 const win=state.winnerId===me()?.id;
 const title=win?'勝利':'敗北';
 const reason=esc(state.winReason||'対戦終了');
 modal(`<div class="result-card ${win?'result-win':'result-lose'}">
   <div class="result-kicker">BATTLE LINE</div>
   <h2>${title}</h2>
   <p class="result-reason">${reason}</p>
   <div class="result-score"><div><span>${esc(me().name)}</span><b>⚑ ${me().flags}</b></div><em>VS</em><div><span>${esc(opp()?.name||'CPU')}</span><b>⚑ ${opp()?.flags||0}</b></div></div>
   <div class="result-actions">
    <button id="rematchBtn" class="result-primary">再戦</button>
    <button id="lobbyBtn" class="result-secondary">ロビーへ戻る</button>
    <button id="boardBtn" class="result-ghost">盤面を見る</button>
   </div>
 </div>`);
 $('#boardBtn').onclick=()=>{resultDismissed=true;closeModal()};
 $('#lobbyBtn').onclick=()=>send('backLobby');
 $('#rematchBtn').onclick=()=>send('rematch');
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
$('#name').value=sessionStorage.getItem('battle-line-name-draft')??commonSavedName();$('#name').oninput=e=>sessionStorage.setItem('battle-line-name-draft',e.target.value);
$('#leaveBtn').onclick=leaveCurrentRoom;$('#startBtn').onclick=()=>send('start');
for(const [id,key] of [['tactics','tactics'],['claimRule','claimRule'],['first','first'],['cpu','cpuLevel']])$('#'+id).onchange=e=>send('settings',{key,value:id==='tactics'?e.target.value==='true':id==='cpu'?+e.target.value:e.target.value});
$('#troopDeck').onclick=()=>{if(state?.phase==='draw')send('draw',{deck:'troop'})};$('#tacticDeck').onclick=()=>{if(state?.phase==='draw')send('draw',{deck:'tactic'})};$('#historyBtn').onclick=()=>modal('<h2>ログ</h2>'+(state.history||[]).slice().reverse().map(x=>`<div class="log">${esc(x)}</div>`).join(''));
$('#rulesBtn').onclick=()=>modal(`<div class="rules"><h2>ルール・用語</h2>
<h3>役の強さ</h3><ol class="formation-list"><li><b>ウェッジ</b>：同じ色で連続した数字。</li><li><b>ファランクス</b>：同じ数字。</li><li><b>バタリオン</b>：同じ色。</li><li><b>スカーミッシャー</b>：連続した数字。</li><li><b>ホスト</b>：上記以外。</li></ol><ul><li>上から順に強い役です。</li><li>同じ役なら数字合計が大きい側が上。</li><li>同じ役・同じ合計なら先に完成した側が上。</li></ul>
<h3>戦術カード詳細</h3><ul><li><b>リーダー</b>：色・数字を自由に扱うワイルド。</li><li><b>援軍騎兵</b>：数字8・色自由。</li><li><b>盾兵</b>：数字1～3・色自由。</li><li><b>霧</b>：その旗は役を無視し、数字合計だけで比較。</li><li><b>泥濘</b>：その旗を3枚編成から4枚編成へ変更。</li><li><b>偵察</b>：カードを追加で確認・交換する戦術。</li><li><b>再配置</b>：自分の配置済みカード1枚を別の戦線へ移動。</li><li><b>脱走</b>：相手の配置済みカード1枚を捨てる。</li><li><b>裏切り</b>：相手の部隊カード1枚を自分側へ移す。</li><li>戦術カードは、自分の使用枚数が相手より最大1枚多いところまで使用可能。</li></ul>
<h3>勝利条件</h3><ul><li>中央の9本のフラッグを争います。</li><li><b>隣接する3本</b>を連続で獲得すると勝利。</li><li>または場所を問わず<b>5本</b>獲得すると勝利。</li></ul>
<h3>ターン</h3><ul><li>カードを1枚プレイ。</li><li>部隊山札または戦術山札から1枚ドロー。</li><li>相手の手番へ移ります。</li><li>獲得可能なフラッグは旗を押して宣言します。</li></ul>
<h3>フラッグ獲得</h3><ul><li>双方完成時はフォーメーションを比較します。</li><li>相手が未完成でも、公開情報上どう完成しても逆転できない場合は獲得宣言できます。</li><li>相手の手札内容は判定材料にしません。</li></ul>
<h3>用語</h3><ul><li><b>部隊カード</b>：6色×1～10の通常カード。</li><li><b>戦線</b>：各フラッグを挟んだ双方のカード配置場所。</li><li><b>獲得宣言</b>：条件を満たしたフラッグを自分のものとして確定する操作。</li></ul></div>`);
function leaveCurrentRoom(){if(!currentRoomId)return; if(!confirm('ROOMから退室しますか？'))return; send('leave'); const room=currentRoomId; currentRoomId=null; state=null; selectedCard=null; clearTimeout(reconnectTimer); localStorage.removeItem(`${GAME_ID}-online-room`);localStorage.removeItem(`${GAME_ID}-online-active-name`);localStorage.removeItem(tokenKey(room));try{ws?.close()}catch{};ws=null;screen('#title');setTimeout(loadRooms,250)}
$('#gameLeaveBtn').onclick=leaveCurrentRoom;$('#reopenResultBtn').onclick=()=>{resultDismissed=false;showResult(true)};$('#returnLobbyBtn').onclick=()=>send('backLobby');$('#modalClose').onclick=closeModal;
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&currentRoomId&&(!ws||ws.readyState!==1))scheduleReconnect()});window.addEventListener('online',scheduleReconnect);
setInterval(()=>{if($('#title').classList.contains('active'))loadRooms()},5000);loadRooms();
const ar=localStorage.getItem(`${GAME_ID}-online-room`),an=localStorage.getItem(`${GAME_ID}-online-active-name`);if(ar&&an){currentRoomId=ar;currentPlayerName=an;connect()}
