// [1] 전역 변수 설정
let myProfile = { name: "", type: "", side: "" }; 
let currentRoomId = ""; 

// [2] 캐릭터 선택 함수 수정
function selectCharacter(name, isAdmin, num) {
    myProfile.name = name;
    myProfile.type = isAdmin ? "ADMIN" : "PLAYER";

    const profileDisplay = document.getElementById('user-profile-display');
    const myNameEl = document.getElementById('my-char-name');
    const myImgEl = document.getElementById('my-char-img');

    if (profileDisplay) {
        profileDisplay.classList.remove('hidden');
        myNameEl.innerText = name; 

        // 이름에서 첫 단어만 추출 (예: '다이애나 닉스' -> '다이애나')
        const firstName = name.split(' ')[0];
        const imageNum = num || "1"; 
        
        // [수정 핵심] 경로에서 '다이애나'를 지우고 변수만 사용합니다.
        // 파일명이 '다이애나1.png', '레오2.png' 식이라면 아래 코드가 정확합니다.
        myImgEl.innerHTML = `<img src="image/${firstName}${imageNum}.png" class="w-full h-full object-cover" onerror="this.src='image/default.png'">`;
    }

    document.getElementById('character-selection').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
    
    console.log(`${name}으로 접속했습니다.`);
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
        gameStarted: false,
        messages: []
    };

    await window.dbUtils.setDoc(roomRef, initialData);
    joinRoom(newRoomId, "left");
}

// [4] 방 입장
async function joinRoom(roomId, side) {
    myProfile.side = side;
    currentRoomId = roomId;
    
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    const roomSnap = await window.dbUtils.getDoc(roomRef);
    const currentCount = roomSnap.exists() ? (roomSnap.data().playersCount || 0) : 0;

    const updateData = {};
    updateData[`name_${side}`] = myProfile.name;
    updateData['playersCount'] = currentCount + 1;
    updateData['messages'] = window.dbUtils.arrayUnion({
        sender: "시스템",
        text: `${myProfile.name} 님이 ${side === 'left' ? '왼쪽' : '오른쪽'} 팀으로 입장했습니다.`,
        timestamp: new Date().getTime()
    });

    await window.dbUtils.updateDoc(roomRef, updateData);

// [확인] 인게임 진입 시 좌상단 프로필 숨기기
    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) profileDisplay.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('battle-screen').classList.remove('hidden');
    
    startRealtimeUpdate(roomId);
}

// [5] 다이스 굴리기
async function rollDice(side) {
    if (myProfile.side !== side && myProfile.type !== "ADMIN") {
        alert("본인의 다이스만 굴릴 수 있습니다!");
        return;
    }
    const diceEl = document.getElementById(`dice-${side}`);
    diceEl.classList.add('dice-rolling');
    const result = Math.floor(Math.random() * 100) + 1;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, { [`dice_${side}`]: result });
}

// [6] 선공 판정 전역 공유
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

// [7] 실시간 업데이트
function startRealtimeUpdate(roomId) {
    const roomRef = window.dbUtils.doc(window.db, "rooms", roomId);
    window.dbUtils.onSnapshot(roomRef, (doc) => {
        const data = doc.data();
        if (!data) return;

        ['left', 'right'].forEach(side => {
            const nameEl = document.getElementById(`name-${side}`);
            const imgEl = document.getElementById(`img-${side}`);
            if (data[`name_${side}`]) {
                nameEl.innerText = data[`name_${side}`];
                const charNum = data[`name_${side}`].replace(/[^0-9]/g, "");
                if(charNum) {
                    imgEl.innerHTML = `<img src="image/다이애나${charNum}.png" class="w-full h-full object-cover" onerror="this.style.display='none'">`;
                }
            } else {
                nameEl.innerText = "대기 중...";
                imgEl.innerHTML = '<span class="text-gray-500">No Image</span>';
            }
            const dVal = data[`dice_${side}`];
            if (dVal > 0) {
                const el = document.getElementById(`dice-${side}`);
                el.innerText = dVal;
                el.classList.remove('dice-rolling');
            }
        });

        if (data.dice_left > 0 && data.dice_right > 0) {
            const isLeftWinner = data.dice_left >= data.dice_right;
            if ((isLeftWinner && myProfile.side === 'left') || (!isLeftWinner && myProfile.side === 'right')) {
                determineTurnOrderShared(data);
            }
            const winnerSide = isLeftWinner ? 'left' : 'right';
            document.getElementById(`btns-${winnerSide}`).classList.remove('hidden');
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

// [8] 뒤로가기 및 기권 로직
function backToCharacterSelection() {
    if (!confirm("캐릭터 선택창으로 돌아가시겠습니까?")) return;
// [추가] 프로필 정보 숨기기
    const profileDisplay = document.getElementById('user-profile-display');
    if (profileDisplay) profileDisplay.classList.add('hidden');
    document.getElementById('game-lobby').classList.add('hidden');
    document.getElementById('character-selection').classList.remove('hidden');
    myProfile = { name: "", type: "", side: "" };
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
                    messages: window.dbUtils.arrayUnion({ sender: "시스템", text: `${myProfile.name} 님이 퇴장했습니다.`, timestamp: new Date().getTime() })
                };
                updateData[`name_${myProfile.side}`] = ""; 
                await window.dbUtils.updateDoc(roomRef, updateData);
            }
        }
    }
    currentRoomId = "";
    myProfile.side = "";
    document.getElementById('user-profile-display').classList.remove('hidden');
    document.getElementById('battle-screen').classList.add('hidden');
    document.getElementById('game-lobby').classList.remove('hidden');
}

// [9] 채팅 전송
async function sendChat() {
    const input = document.getElementById('chat-input');
    if (!input.value || !currentRoomId) return;
    const roomRef = window.dbUtils.doc(window.db, "rooms", currentRoomId);
    await window.dbUtils.updateDoc(roomRef, {
        messages: window.dbUtils.arrayUnion({ sender: myProfile.name, text: input.value, timestamp: new Date().getTime() })
    });
    input.value = "";
}

// [10] 초기화 및 리스트 로드
function listenToRoomList() {
    const roomsCollection = window.dbUtils.collection(window.db, "rooms");
    window.dbUtils.onSnapshot(roomsCollection, (snapshot) => {
        const roomListDiv = document.getElementById('room-list');
        if(!roomListDiv) return;
        roomListDiv.innerHTML = snapshot.empty ? '<p class="text-center text-gray-400">생성된 방이 없습니다.</p>' : "";
        snapshot.forEach((doc) => {
            const roomData = doc.data();
            const roomItem = document.createElement('div');
            roomItem.className = "flex justify-between items-center bg-gray-700/50 p-3 mb-2 rounded hover:bg-gray-600 transition";
            roomItem.innerHTML = `<div><span class="text-yellow-400 font-bold">[${roomData.roomType}]</span> ${roomData.roomName || doc.id}</div>
                <button onclick="joinRoom('${doc.id}', 'right')" class="bg-green-600 px-3 py-1 rounded text-sm">입장</button>`;
            roomListDiv.appendChild(roomItem);
        });
    });
}

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

window.onbeforeunload = function() { if (currentRoomId) backToLobby(); };

function init() { listenToRoomList(); }
if (document.readyState === "complete" || document.readyState === "interactive") { init(); } else { window.onload = init; }

// 전역 윈도우 객체 할당
window.rollDice = rollDice;
window.createRoom = createRoom;
window.joinRoom = joinRoom;
window.sendChat = sendChat;
window.backToCharacterSelection = backToCharacterSelection;
window.backToLobby = backToLobby;
window.openCreateModal = openCreateModal;
window.closeCreateModal = closeCreateModal;
window.confirmCreateRoom = confirmCreateRoom;
window.selectCharacter = selectCharacter;