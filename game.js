// [1] 전역 변수 설정
let myProfile = { name: "", type: "", side: "" }; 
let currentRoomId = ""; 

// ─────────────────────────────────────────
// 주사위 유틸
// ─────────────────────────────────────────
function roll(max) { return Math.floor(Math.random() * max) + 1; }
function roll1d15() { return roll(15); }
function roll1d5()  { return roll(5);  }
function rollAttack()  { return roll1d15() + roll1d5(); } // 최소 2, 최대 20
function rollDefense() { return roll1d15() + roll1d5(); }

// ─────────────────────────────────────────
// [2] 캐릭터 선택
// ─────────────────────────────────────────
function selectCharacter(name, isAdmin, num) {
    myProfile.name = name;
    myProfile.charId = `${name}|${num || 1}`; 
    myProfile.type = isAdmin ? "ADMIN" : "PLAYER";

    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) {
        profileDisplay.classList.remove('hidden');
        document.getElementById('my-char-name').innerText = name; 
        const imgSrc = isAdmin ? "image/관리자.png" : `image/${name.split(' ')[0]}${num || 1}.png`;
        document.getElementById('my-char-img').innerHTML = `<img src="${imgSrc}" class="w-full h-full object-cover">`;
    }

    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// ─────────────────────────────────────────
// [3] 방 만들기
// ─────────────────────────────────────────
async function createRoom(type, title) {
    const newRoomId = title + "_" + Math.floor(Math.random() * 1000);
    const roomRef = window.dbUtils.doc(window.db, "rooms", newRoomId);
    
    const initialData = {
        roomType: type,
        roomName: title,
        status: "waiting",
        hp_left: 100,
        hp_right: 100,
        dice_left: 0,
        dice_right: 0,
        playersCount: 0, 
        currentRound: 1,
        isDetermined: false,
        ready_left: false,
        ready_right: false,
        name_left: "",
        name_right: "",
        // 전투 행동 관련 필드
        action_left: "",
        action_right: "",
        actionResult: null,
        messages: []
    };

    await window.dbUtils.setDoc(roomRef, initialData);
    const creatorSide = myProfile.type === "ADMIN" ? "admin" : "left";
    joinRoom(newRoomId, creatorSide);
}

// ─────────────────────────────────────────
// [4] 방 입장
// ─────────────────────────────────────────
async function joinRoom(roomId, side) {
    currentRoomId = roomId;
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    let updateData = {};

    try {
        if (myProfile.type === "ADMIN" || side === "admin") {
            updateData = {
                messages: window.dbUtils.arrayUnion({
                    sender: "시스템",
                    text: `관리자 님이 입장했습니다.`,
                    timestamp: new Date().getTime()
                })
            };
            myProfile.side = "admin";
        } else {
            myProfile.side = side;
            updateData = {
                playersCount: window.dbUtils.increment(1),
                messages: window.dbUtils.arrayUnion({
                    sender: "시스템",
                    text: `${myProfile.name} 님이 ${side === 'left' ? '왼쪽' : '오른쪽'} 팀으로 입장했습니다.`,
                    timestamp: new Date().getTime()
                })
            };
            updateData[`name_${side}`] = myProfile.charId;
        }
        await window.dbUtils.updateDoc(roomRef, updateData);
    } catch (e) {
        console.error("joinRoom Firestore 오류:", e);
    }

    ['left', 'right'].forEach(s => {
        const btns = document.getElementById(`btns-${s}`);
        if (btns) btns.classList.add('hidden');
        const readyBtn = document.getElementById(`ready-btn-${s}`);
        if (readyBtn) readyBtn.classList.add('hidden');
        const diceEl = document.getElementById(`dice-${s}`);
        if (diceEl) { diceEl.innerText = '?'; diceEl.classList.remove('dice-rolling'); }
    });
    const readyOverlay = document.getElementById('ready-overlay');
    if (readyOverlay) readyOverlay.classList.add('hidden');

    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('user-profile-display').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    startRealtimeUpdate(roomId);
}

// ─────────────────────────────────────────
// [5] 다이스 굴리기 (선공 판정용, 1d100)
// ─────────────────────────────────────────
async function rollDice(side) {
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!");
        return;
    }
    if (!currentRoomId) return;
    const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", currentRoomId));
    if (!snap.exists() || snap.data().status !== "fighting") {
        alert("관리자가 전투를 시작한 후에 다이스를 굴릴 수 있습니다!");
        return;
    }
    // 이미 굴렸으면 중복 방지
    if (snap.data()[`dice_${side}`] > 0) {
        alert("이미 다이스를 굴렸습니다!");
        return;
    }

    const diceEl = document.getElementById(`dice-${side}`);
    diceEl.classList.add('dice-rolling');
    
    const result = Math.floor(Math.random() * 100) + 1;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);

    setTimeout(async () => {
        await window.dbUtils.updateDoc(roomRef, { [`dice_${side}`]: result });
    }, 500);
}

// ─────────────────────────────────────────
// [레디] 플레이어 레디 토글
// ─────────────────────────────────────────
async function toggleReady(side) {
    if (myProfile.side !== side) return;
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const current = snap.data()[`ready_${side}`] || false;
    await window.dbUtils.updateDoc(roomRef, { [`ready_${side}`]: !current });
}

// ─────────────────────────────────────────
// [6] 선공 판정
// ─────────────────────────────────────────
async function determineTurnOrderShared(data) {
    if (data.isDetermined === true) return;
    const isLeftWinner = data.dice_left >= data.dice_right;
    const winnerName = isLeftWinner ? data.name_left.split('|')[0] : data.name_right.split('|')[0];
    const loserName  = isLeftWinner ? data.name_right.split('|')[0] : data.name_left.split('|')[0];
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        isDetermined: true,
        // firstSide: 선공이 누구인지 저장
        firstSide: isLeftWinner ? "left" : "right",
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: `🎲 다이스 결과 — ${winnerName}(${data.dice_left}) vs ${loserName}(${data.dice_right}) → ${winnerName} 선공!`,
            timestamp: new Date().getTime()
        })
    });
}

// ─────────────────────────────────────────
// [전투] 행동 선택 (본인 행동만 Firestore에 저장)
// ─────────────────────────────────────────
async function selectAction(action) {
    if (!currentRoomId) return;
    const side = myProfile.side;
    if (side !== 'left' && side !== 'right') return;

    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const data = snap.data();

    // 도주는 3라운드부터
    if (action === '도주' && (data.currentRound || 1) < 3) {
        alert("도주는 3라운드부터 할 수 있습니다!");
        return;
    }

    // 이미 행동 선택했으면 중복 방지
    if (data[`action_${side}`]) {
        alert("이미 행동을 선택했습니다!");
        return;
    }

    // 행동 저장 + 버튼 비활성화
    await window.dbUtils.updateDoc(roomRef, {
        [`action_${side}`]: action,
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: `${myProfile.name} 님이 행동을 선택했습니다.`,
            timestamp: new Date().getTime()
        })
    });

    // 버튼 비활성화 (UI 즉시 반영)
    const btns = document.getElementById(`btns-${side}`);
    if (btns) {
        btns.querySelectorAll('button').forEach(b => b.disabled = true);
        // 선택한 행동 표시
        btns.querySelectorAll('button').forEach(b => {
            if (b.textContent.trim() === action) {
                b.style.outline = '3px solid white';
                b.style.opacity = '1';
            } else {
                b.style.opacity = '0.3';
            }
        });
    }

    // 양쪽 다 행동 선택 시 → 결과 계산 (왼쪽 플레이어 or 관리자가 대표로 계산)
    const newSnap = await window.dbUtils.getDoc(roomRef);
    const newData = newSnap.data();
    if (newData.action_left && newData.action_right) {
        if (myProfile.side === 'left' || myProfile.type === 'ADMIN') {
            await resolveCombat(newData, roomRef);
        }
    }
}

// ─────────────────────────────────────────
// [전투] 결과 계산 핵심 로직
// ─────────────────────────────────────────
async function resolveCombat(data, roomRef) {
    const aL = data.action_left;
    const aR = data.action_right;
    const round = data.currentRound || 1;

    let hp_left  = data.hp_left;
    let hp_right = data.hp_right;
    const logs = [];

    const nameL = data.name_left.split('|')[0];
    const nameR = data.name_right.split('|')[0];

    // ── 행동 쌍별 처리 ──
    // 공격 vs 공격
    if (aL === '공격' && aR === '공격') {
        const atkL = rollAttack();
        const atkR = rollAttack();
        hp_right = Math.max(0, hp_right - atkL);
        hp_left  = Math.max(0, hp_left  - atkR);
        logs.push(`⚔️ 동시 공격! ${nameL}의 공격 ${atkL} / ${nameR}의 공격 ${atkR}`);
        logs.push(`💥 ${nameR} -${atkL}HP / ${nameL} -${atkR}HP`);
    }
    // 공격 vs 방어
    else if (aL === '공격' && aR === '방어') {
        const atk = rollAttack();
        const def = rollDefense();
        const dmg = Math.max(0, atk - def);
        hp_right = Math.max(0, hp_right - dmg);
        logs.push(`⚔️ ${nameL} 공격(${atk}) vs 🛡️ ${nameR} 방어(${def})`);
        logs.push(dmg > 0 ? `💥 ${nameR} -${dmg}HP` : `🛡️ ${nameR} 완전히 막아냈습니다!`);
    }
    // 방어 vs 공격
    else if (aL === '방어' && aR === '공격') {
        const atk = rollAttack();
        const def = rollDefense();
        const dmg = Math.max(0, atk - def);
        hp_left = Math.max(0, hp_left - dmg);
        logs.push(`⚔️ ${nameR} 공격(${atk}) vs 🛡️ ${nameL} 방어(${def})`);
        logs.push(dmg > 0 ? `💥 ${nameL} -${dmg}HP` : `🛡️ ${nameL} 완전히 막아냈습니다!`);
    }
    // 공격 vs 회피
    else if (aL === '공격' && aR === '회피') {
        const atk = rollAttack();
        const dodged = Math.random() < 0.5;
        if (dodged) {
            logs.push(`⚔️ ${nameL} 공격(${atk}) vs 💨 ${nameR} 회피 → 성공! 피해 없음`);
        } else {
            hp_right = Math.max(0, hp_right - atk);
            logs.push(`⚔️ ${nameL} 공격(${atk}) vs 💨 ${nameR} 회피 → 실패! -${atk}HP`);
        }
    }
    // 회피 vs 공격
    else if (aL === '회피' && aR === '공격') {
        const atk = rollAttack();
        const dodged = Math.random() < 0.5;
        if (dodged) {
            logs.push(`💨 ${nameL} 회피 성공! vs ⚔️ ${nameR} 공격(${atk}) → 피해 없음`);
        } else {
            hp_left = Math.max(0, hp_left - atk);
            logs.push(`💨 ${nameL} 회피 실패! vs ⚔️ ${nameR} 공격(${atk}) → -${atk}HP`);
        }
    }
    // 공격 vs 도주
    else if (aL === '공격' && aR === '도주') {
        const atk = rollAttack();
        const escaped = Math.random() < 0.5;
        if (escaped) {
            logs.push(`🏃 ${nameR} 도주 성공! → ${nameR} 패배 처리`);
            hp_right = 0; // 도주 성공 = 패배
        } else {
            hp_right = Math.max(0, hp_right - atk);
            logs.push(`🏃 ${nameR} 도주 실패! ⚔️ ${nameL} 공격(${atk}) → -${atk}HP`);
        }
    }
    // 도주 vs 공격
    else if (aL === '도주' && aR === '공격') {
        const atk = rollAttack();
        const escaped = Math.random() < 0.5;
        if (escaped) {
            logs.push(`🏃 ${nameL} 도주 성공! → ${nameL} 패배 처리`);
            hp_left = 0;
        } else {
            hp_left = Math.max(0, hp_left - atk);
            logs.push(`🏃 ${nameL} 도주 실패! ⚔️ ${nameR} 공격(${atk}) → -${atk}HP`);
        }
    }
    // 도주 vs 도주 (둘 다 도주 시도)
    else if (aL === '도주' && aR === '도주') {
        const escL = Math.random() < 0.5;
        const escR = Math.random() < 0.5;
        logs.push(`🏃 ${nameL} 도주 ${escL ? '성공' : '실패'} / ${nameR} 도주 ${escR ? '성공' : '실패'}`);
        if (escL) hp_left = 0;
        if (escR) hp_right = 0;
    }
    // 그 외(방어vs방어, 방어vs회피, 회피vs방어, 회피vs회피 등) → 아무 일 없음
    else {
        logs.push(`🤝 ${nameL}(${aL}) vs ${nameR}(${aR}) — 서로 맞붙지 않아 피해가 없습니다.`);
    }

    // ── 라운드 종료 메시지 ──
    const newRound = round + 1;
    const isGameOver = hp_left <= 0 || hp_right <= 0 || round >= 5;

    let resultMsg = [];
    logs.forEach(l => resultMsg.push({ sender: "시스템", text: l, timestamp: new Date().getTime() }));

    if (isGameOver) {
        let endText = "";
        if (hp_left <= 0 && hp_right <= 0) {
            endText = "⚡ 양측 동시 전투 불능! 무승부!";
        } else if (hp_left <= 0) {
            endText = `🏆 ${nameR} 승리!`;
        } else if (hp_right <= 0) {
            endText = `🏆 ${nameL} 승리!`;
        } else {
            // 5라운드 종료
            endText = hp_left > hp_right
                ? `🏆 5라운드 종료 — HP 우세 ${nameL} 승리! (${hp_left} vs ${hp_right})`
                : hp_right > hp_left
                ? `🏆 5라운드 종료 — HP 우세 ${nameR} 승리! (${hp_left} vs ${hp_right})`
                : `⚡ 5라운드 종료 — 무승부! (${hp_left} vs ${hp_right})`;
        }
        resultMsg.push({ sender: "시스템", text: endText, timestamp: new Date().getTime() + 1 });

        await window.dbUtils.updateDoc(roomRef, {
            hp_left,
            hp_right,
            action_left: "",
            action_right: "",
            status: "ended",
            messages: window.dbUtils.arrayUnion(...resultMsg)
        });
    } else {
        resultMsg.push({
            sender: "시스템",
            text: `— ROUND ${newRound} 시작 —`,
            timestamp: new Date().getTime() + 1
        });

        await window.dbUtils.updateDoc(roomRef, {
            hp_left,
            hp_right,
            action_left: "",
            action_right: "",
            currentRound: newRound,
            messages: window.dbUtils.arrayUnion(...resultMsg)
        });
    }
}

// ─────────────────────────────────────────
// [7] 실시간 업데이트
// ─────────────────────────────────────────
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (doc) => {
        const data = doc.data();
        if (!data) return;

        // 다이스 박스 활성/비활성
        ['left', 'right'].forEach(s => {
            const dBox = document.getElementById(`dice-${s}`);
            if (dBox) {
                if (data.status === 'fighting') {
                    dBox.style.opacity = '1';
                    dBox.style.cursor = 'pointer';
                } else {
                    dBox.style.opacity = '0.35';
                    dBox.style.cursor = 'not-allowed';
                }
            }
        });

        // 이름 & 이미지 반영
        ['left', 'right'].forEach(side => {
            const nameEl = document.getElementById(`name-${side}`);
            const imgEl  = document.getElementById(`img-${side}`);
            const dBox   = document.getElementById(`dice-${side}`);
            const rawData = data[`name_${side}`];

            if (rawData && rawData.includes('|')) {
                const [fullName, num] = rawData.split('|');
                const firstName = fullName.split(' ')[0];
                nameEl.innerText = fullName;
                imgEl.innerHTML  = `<img src="image/${firstName}${num}.png" class="w-full h-full object-cover">`;
            } else if (rawData) {
                nameEl.innerText = rawData;
                imgEl.innerHTML  = '<span class="text-gray-500">No Image</span>';
            } else {
                nameEl.innerText = "대기 중...";
                imgEl.innerHTML  = '<span class="text-gray-500 italic">No Image</span>';
            }

            if (data[`dice_${side}`] > 0) {
                dBox.innerText = data[`dice_${side}`];
                dBox.classList.remove('dice-rolling');
            } else {
                dBox.innerText = "?";
            }
        });

        // 레디 버튼
        const bothJoined = data.name_left && data.name_right;
        const readyOverlay = document.getElementById('ready-overlay');

        ['left', 'right'].forEach(s => {
            const btn = document.getElementById(`ready-btn-${s}`);
            if (!btn) return;
            if (bothJoined && data.status === "waiting" && myProfile.side === s) {
                btn.classList.remove('hidden');
                const isReady = data[`ready_${s}`];
                btn.textContent  = isReady ? '✔ 레디 완료' : '○ 레디';
                btn.style.borderColor = isReady ? '#57825a' : '';
                btn.style.color       = isReady ? '#89b38c' : '';
            } else {
                btn.classList.add('hidden');
            }
        });

        // 레디 오버레이
        const bothReady = bothJoined && data.ready_left && data.ready_right;
        if (bothReady && data.status === "waiting") {
            if (readyOverlay) readyOverlay.classList.remove('hidden');
            const startBtn = document.getElementById('start-game-btn');
            if (startBtn) {
                startBtn.classList.toggle('hidden', myProfile.type !== "ADMIN");
                document.getElementById('waiting-msg').style.display =
                    myProfile.type === "ADMIN" ? 'none' : '';
            }
        } else {
            if (readyOverlay) readyOverlay.classList.add('hidden');
        }

        // 선공 판정: 두 다이스가 모두 0보다 크면 실행
        if (data.status === 'fighting' && data.dice_left > 0 && data.dice_right > 0 && !data.isDetermined) {
            if (myProfile.side === 'left' || myProfile.type === 'ADMIN') {
                determineTurnOrderShared(data);
            }
        }

        // ── 행동 버튼 표시 로직 ──
        // fighting 상태 + 선공 판정 완료 + 게임 미종료 상태일 때만
        if (data.status === 'fighting' && data.isDetermined) {
            ['left', 'right'].forEach(s => {
                const btns = document.getElementById(`btns-${s}`);
                if (!btns) return;

                // 내 side이고, 아직 행동 미선택 상태면 버튼 표시
                if (myProfile.side === s && !data[`action_${s}`]) {
                    btns.classList.remove('hidden');
                    // 버튼 초기화 (라운드 시작 시 리셋)
                    btns.querySelectorAll('button').forEach(b => {
                        b.disabled = false;
                        b.style.opacity = '1';
                        b.style.outline = '';
                    });
                    // 도주 버튼: 3라운드 미만이면 비활성화
                    const escapeBtnIndex = 3; // 4번째 버튼 = 도주
                    const escapeBtn = btns.querySelectorAll('button')[escapeBtnIndex];
                    if (escapeBtn && (data.currentRound || 1) < 3) {
                        escapeBtn.disabled = true;
                        escapeBtn.style.opacity = '0.4';
                        escapeBtn.title = '3라운드부터 사용 가능';
                    }
                } else if (myProfile.side === s && data[`action_${s}`]) {
                    // 이미 선택함 → 버튼 비활성
                    btns.classList.remove('hidden');
                    btns.querySelectorAll('button').forEach(b => {
                        b.disabled = true;
                        b.style.opacity = b.textContent.trim() === data[`action_${s}`] ? '1' : '0.3';
                        b.style.outline = b.textContent.trim() === data[`action_${s}`] ? '3px solid white' : '';
                    });
                } else {
                    btns.classList.add('hidden');
                }
            });
        } else if (data.status !== 'fighting') {
            ['left', 'right'].forEach(s => {
                const btns = document.getElementById(`btns-${s}`);
                if (btns) btns.classList.add('hidden');
            });
        }

        // 게임 종료 처리
        if (data.status === 'ended') {
            ['left', 'right'].forEach(s => {
                const btns = document.getElementById(`btns-${s}`);
                if (btns) btns.classList.add('hidden');
            });
            // 다이스도 잠금
            ['left', 'right'].forEach(s => {
                const dBox = document.getElementById(`dice-${s}`);
                if (dBox) { dBox.style.opacity = '0.35'; dBox.style.cursor = 'not-allowed'; }
            });
        }

        // HP 바
        document.getElementById('hp-left').style.width  = Math.max(0, data.hp_left  ?? 100) + "%";
        document.getElementById('hp-right').style.width = Math.max(0, data.hp_right ?? 100) + "%";
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound || 1} / 5`;

        // 채팅 로그
        if (data.messages) {
            const chatBox = document.getElementById('chat-messages');
            if (chatBox.children.length !== data.messages.length) {
                chatBox.innerHTML = "";
                data.messages.forEach(msg => {
                    const log = document.createElement('div');
                    log.className = "text-white py-1 border-b border-white/10";
                    if (msg.sender === "시스템") {
                        log.innerHTML = `<span class="text-yellow-400 font-bold">[안내] ${msg.text}</span>`;
                    } else {
                        log.innerHTML = `<span class="text-blue-400 font-bold">${msg.sender}:</span> ${msg.text}`;
                    }
                    chatBox.appendChild(log);
                });
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }
    });
}

// ─────────────────────────────────────────
// [8] 채팅 & UI 유틸
// ─────────────────────────────────────────
function setupChatEventListeners() {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendChat();
        });
    }
}

function listenToRoomList() {
    const roomsCollection = window.dbUtils.collection(window.db, "rooms");
    window.dbUtils.onSnapshot(roomsCollection, (snapshot) => {
        const roomListDiv = document.getElementById('room-list');
        if (!roomListDiv) return;
        roomListDiv.innerHTML = snapshot.empty
            ? '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>'
            : "";
        
        snapshot.forEach((doc) => {
            const roomData = doc.data();
            const roomId   = doc.id;
            const roomItem = document.createElement('div');
            roomItem.className = "flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            roomItem.innerHTML = `
                <div><span class="text-yellow-400 font-bold">[${roomData.roomType}]</span> ${roomData.roomName || roomId}</div>
                <button class="join-btn bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500" data-room-id="${roomId}">입장</button>
            `;
            roomItem.querySelector('.join-btn').addEventListener('click', async () => {
                if (myProfile.type === "ADMIN") { joinRoom(roomId, "admin"); return; }
                try {
                    const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", roomId));
                    if (!snap.exists()) return;
                    const d = snap.data();
                    const leftTaken = typeof d.name_left === "string" && d.name_left.trim() !== "";
                    joinRoom(roomId, leftTaken ? "right" : "left");
                } catch(e) {
                    console.error("자리 확인 오류:", e);
                    joinRoom(roomId, "left");
                }
            });
            roomListDiv.appendChild(roomItem);
        });
    });
}

// ─────────────────────────────────────────
// [통합 init]
// ─────────────────────────────────────────
function init() {
    listenToRoomList();
    setupChatEventListeners();
}

window.onload = init;

// ─────────────────────────────────────────
// 전역 함수 등록
// ─────────────────────────────────────────
window.rollDice             = rollDice;
window.createRoom           = createRoom;
window.joinRoom             = joinRoom;
window.sendChat             = sendChat;
window.selectCharacter      = selectCharacter;
window.backToLobby          = backToLobby;
window.backToCharacterSelection = backToCharacterSelection;
window.openCreateModal      = openCreateModal;
window.closeCreateModal     = closeCreateModal;
window.confirmCreateRoom    = confirmCreateRoom;
window.startGame            = startGame;
window.toggleReady          = toggleReady;
window.selectAction         = selectAction;

// ─────────────────────────────────────────
// 기타 함수
// ─────────────────────────────────────────
function openCreateModal()  { document.getElementById('create-room-modal').classList.remove('hidden'); }
function closeCreateModal() { document.getElementById('create-room-modal').classList.add('hidden'); }

async function confirmCreateRoom() {
    const titleInput = document.getElementById('room-title-input');
    const typeSelect = document.getElementById('room-type-select');
    const title = titleInput.value.trim() || "즐거운 전투";
    const type  = typeSelect.value;
    closeCreateModal();
    await createRoom(type, title); 
    titleInput.value = "";
}

async function backToLobby() {
    if (!confirm("정말 전투를 포기하고 로비로 나가시겠습니까?")) return;
    if (currentRoomId) {
        const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
        const roomSnap = await window.dbUtils.getDoc(roomRef);
        if (roomSnap.exists()) {
            const data = roomSnap.data();
            const newCount = (data.playersCount || 1) - 1;
            if (newCount <= 0) {
                await window.dbUtils.deleteDoc(roomRef);
            } else {
                const updateData = {
                    playersCount: newCount,
                    messages: window.dbUtils.arrayUnion({
                        sender: "시스템",
                        text: `${myProfile.name} 님이 퇴장했습니다.`,
                        timestamp: new Date().getTime()
                    })
                };
                updateData[`name_${myProfile.side}`] = "";
                await window.dbUtils.updateDoc(roomRef, updateData);
            }
        }
    }
    currentRoomId = ""; myProfile.side = "";
    document.getElementById('user-profile-display').classList.remove('hidden');
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

function backToCharacterSelection() {
    if (!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) profileDisplay.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    myProfile = { name: "", type: "", side: "" };
}

async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        messages: window.dbUtils.arrayUnion({
            sender: myProfile.name,
            text: input.value,
            timestamp: new Date().getTime()
        })
    });
    input.value = "";
}

async function startGame() {
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        status: "fighting",
        ready_left: false,
        ready_right: false,
        // 전투 필드 초기화
        dice_left: 0,
        dice_right: 0,
        action_left: "",
        action_right: "",
        isDetermined: false,
        hp_left: 100,
        hp_right: 100,
        currentRound: 1,
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: "⚔️ 전투가 시작되었습니다! 각자 다이스를 굴려 선공을 결정하세요.",
            timestamp: new Date().getTime()
        })
    });
}
