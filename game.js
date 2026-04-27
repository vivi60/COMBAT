// [1] 전역 변수 설정
let myProfile = { name: "", type: "", side: "" }; 
let currentRoomId = ""; 

// [2] 캐릭터 선택 함수 수정
function selectCharacter(name, isAdmin, num) {
    myProfile.name = name;
    // 선택한 캐릭터의 이미지 번호를 이름 뒤에 임시로 붙여서 저장합니다. (예: "레오 휘틀리|2")
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
// [3] 방 만들기
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
        messages: []
    };

    await window.dbUtils.setDoc(roomRef, initialData);
    // 수정 후 (방 생성 후 바로 입장 함수 호출)
    const creatorSide = myProfile.type === "ADMIN" ? "admin" : "left";
    joinRoom(newRoomId, creatorSide);
}

// [4] 방 입장 시 닉네임 저장 수정
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

    // UI 전환은 Firestore 오류와 무관하게 항상 실행
    // 이전 게임 잔재 초기화
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

// [5] 다이스 굴리기 (수정: 0.5초 후 결과 반영으로 시각 효과 부여)
async function rollDice(side) {
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!");
        return;
    }
    if (!currentRoomId) return;
    // 전투 시작 후에만 다이스 굴리기 가능
    const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", currentRoomId));
    if (!snap.exists() || snap.data().status !== "fighting") {
        alert("관리자가 전투를 시작한 후에 다이스를 굴릴 수 있습니다!");
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


// [레디] 플레이어 레디 토글
async function toggleReady(side) {
    if (myProfile.side !== side) return;
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    const snap = await window.dbUtils.getDoc(roomRef);
    if (!snap.exists()) return;
    const current = snap.data()[`ready_${side}`] || false;
    await window.dbUtils.updateDoc(roomRef, { [`ready_${side}`]: !current });
}

// [6] 선공 판정
async function determineTurnOrderShared(data) {
    if (data.isDetermined === true) return;
    let winnerName = data.dice_left >= data.dice_right ? data.name_left : data.name_right;
    let winnerSide = data.dice_left >= data.dice_right ? "왼쪽" : "오른쪽";
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        isDetermined: true, 
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: `다이스 결과: ${winnerName} 님이 선공입니다! (${winnerSide} 팀)`,
            timestamp: new Date().getTime()
        })
    });
}

// [7] 실시간 업데이트 내 이미지 출력 로직 (가장 중요)
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (doc) => {
        const data = doc.data();
        if (!data) return;

        // 다이스 박스: fighting 상태일 때만 활성화 표시
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

        ['left', 'right'].forEach(side => {
            const nameEl = document.getElementById(`name-${side}`);
            const imgEl = document.getElementById(`img-${side}`);
            const dBox = document.getElementById(`dice-${side}`);
            const rawData = data[`name_${side}`]; // "이름|번호" 형태

            if (rawData && rawData.includes('|')) {
                const [fullName, num] = rawData.split('|');
                const firstName = fullName.split(' ')[0];
                nameEl.innerText = fullName;
                imgEl.innerHTML = `<img src="image/${firstName}${num}.png" class="w-full h-full object-cover">`;
            } else if (rawData) {
                // 기존 데이터 호환용
                nameEl.innerText = rawData;
                imgEl.innerHTML = '<span class="text-gray-500">No Image</span>';
            } else {
                nameEl.innerText = "대기 중...";
                imgEl.innerHTML = '<span class="text-gray-500 italic">No Image</span>';
            }

            if (data[`dice_${side}`] > 0) {
                dBox.innerText = data[`dice_${side}`];
                dBox.classList.remove('dice-rolling');
            } else {
                dBox.innerText = "?";
            }
        });
// 양쪽 팀이 모두 들어왔는지 확인
    const bothJoined = data.name_left && data.name_right;
    const readyOverlay = document.getElementById('ready-overlay');

    // 레디 버튼: 본인 팀 버튼만 표시
    ['left', 'right'].forEach(s => {
        const btn = document.getElementById(`ready-btn-${s}`);
        if (!btn) return;
        if (bothJoined && data.status === "waiting" && myProfile.side === s) {
            btn.classList.remove('hidden');
            const isReady = data[`ready_${s}`];
            btn.textContent = isReady ? '✔ 레디 완료' : '○ 레디';
            btn.style.borderColor = isReady ? '#57825a' : '';
            btn.style.color = isReady ? '#89b38c' : '';
        } else {
            btn.classList.add('hidden');
        }
    });

    // 둘 다 레디됐을 때 오버레이 표시
    const bothReady = bothJoined && data.ready_left && data.ready_right;
    if (bothReady && data.status === "waiting") {
        if (readyOverlay) readyOverlay.classList.remove('hidden');
        // 관리자에게만 전투 시작 버튼 표시
        const startBtn = document.getElementById('start-game-btn');
        if (startBtn) {
            if (myProfile.type === "ADMIN") {
                startBtn.classList.remove('hidden');
            } else {
                startBtn.classList.add('hidden');
            }
        }
    } else {
        if (readyOverlay) readyOverlay.classList.add('hidden');
    }
        if (data.dice_left > 0 && data.dice_right > 0) {
            const isLeftWinner = data.dice_left >= data.dice_right;
            if ((isLeftWinner && myProfile.side === 'left') || (!isLeftWinner && myProfile.side === 'right')) {
                determineTurnOrderShared(data);
            }
            const winnerSide = isLeftWinner ? 'left' : 'right';
            const btns = document.getElementById(`btns-${winnerSide}`);
            if(btns) btns.classList.remove('hidden');
        }

        document.getElementById('hp-left').style.width = (data.hp_left || 100) + "%";
        document.getElementById('hp-right').style.width = (data.hp_right || 100) + "%";
        document.getElementById('round-display').innerText = `ROUND ${data.currentRound || 1} / 5`;

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

// [8] 로직 및 초기화 (통합됨)
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
        if(!roomListDiv) return;
        roomListDiv.innerHTML = snapshot.empty ? '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>' : "";
        
        snapshot.forEach((doc) => {
            const roomData = doc.data();
            const roomId = doc.id; // 방 ID (문서 이름)
            const roomItem = document.createElement('div');
            roomItem.className = "flex justify-between items-center bg-gray-700 p-3 mb-2 rounded hover:bg-gray-600 transition";
            
            // 클릭 시점의 myProfile.type을 읽도록 이벤트 리스너로 처리
            roomItem.innerHTML = `
                <div><span class="text-yellow-400 font-bold">[${roomData.roomType}]</span> ${roomData.roomName || roomId}</div>
                <button class="join-btn bg-green-600 px-3 py-1 rounded text-sm hover:bg-green-500" data-room-id="${roomId}">입장</button>
            `;
            roomItem.querySelector('.join-btn').addEventListener('click', async () => {
                if (myProfile.type === "ADMIN") {
                    joinRoom(roomId, "admin");
                    return;
                }
                try {
                    const snap = await window.dbUtils.getDoc(window.dbUtils.doc(window.db, "rooms", roomId));
                    if (!snap.exists()) return;
                    const d = snap.data();
                    const leftTaken = typeof d.name_left === "string" && d.name_left.trim() !== "";
                    const side = leftTaken ? "right" : "left";
                    joinRoom(roomId, side);
                } catch(e) {
                    console.error("자리 확인 오류:", e);
                    joinRoom(roomId, "left");
                }
            });
            roomListDiv.appendChild(roomItem);
        });
    });
}

// [통합 init]
function init() {
    listenToRoomList();
    setupChatEventListeners();
}

window.onload = init;

// 전역 함수 등록
window.rollDice = rollDice;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChat = sendChat;
window.selectCharacter = selectCharacter;
window.backToLobby = backToLobby;
window.backToCharacterSelection = backToCharacterSelection;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.confirmCreateRoom = confirmCreateRoom;
window.startGame = startGame;
window.toggleReady = toggleReady;

// 누락된 함수 추가
function openCreateModal() { document.getElementById('create-room-modal').classList.remove('hidden'); }
function closeCreateModal() { document.getElementById('create-room-modal').classList.add('hidden'); }
async function confirmCreateRoom() {
    const titleInput = document.getElementById('room-title-input');
    const typeSelect = document.getElementById('room-type-select');
    const title = titleInput.value.trim() || "즐거운 전투";
    const type = typeSelect.value;
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
            if (newCount <= 0) { await window.dbUtils.deleteDoc(roomRef); } 
            else {
                const updateData = { playersCount: newCount, messages: window.dbUtils.arrayUnion({ sender: "시스템", text: `${myProfile.name} 님이 퇴장했습니다.`, timestamp: new Date().getTime() }) };
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
    await window.dbUtils.updateDoc(roomRef, { messages: window.dbUtils.arrayUnion({ sender: myProfile.name, text: input.value, timestamp: new Date().getTime() }) });
    input.value = "";
}

// 관리자가 전투 시작을 눌렀을 때 실행되는 함수
async function startGame() {
    if (!currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    
    await window.dbUtils.updateDoc(roomRef, {
        status: "fighting",
        ready_left: false,
        ready_right: false,
        messages: window.dbUtils.arrayUnion({
            sender: "시스템",
            text: "전투가 시작되었습니다!",
            timestamp: new Date().getTime()
        })
    });
}

