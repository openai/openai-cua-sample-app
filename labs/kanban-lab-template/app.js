const columnOrder = ["backlog", "in_progress", "done"];

const cardsById = {
  analytics_spec: {
    detail: "Finalize the analytics rollout checklist for launch week.",
    due: "Thu",
    key: "REL-214",
    owner: "Data",
    priority: "P1",
    title: "Finalize analytics spec",
    track: "Launch",
  },
  bug_triage: {
    detail: "Close the mobile nav bug before the stakeholder review.",
    due: "Today",
    key: "REL-198",
    owner: "Web",
    priority: "P1",
    title: "Close nav bug triage",
    track: "Bugs",
  },
  launch_brief: {
    detail: "Circulate the launch brief to support and sales.",
    due: "Sent",
    key: "REL-176",
    owner: "Comms",
    priority: "P2",
    title: "Circulate launch brief",
    track: "Ops",
  },
  replay_audit: {
    detail: "Review replay artifacts and trim noisy event output.",
    due: "Queued",
    key: "REL-223",
    owner: "Infra",
    priority: "P2",
    title: "Audit replay artifacts",
    track: "Quality",
  },
  tooltips: {
    detail: "Polish tooltips in the operator console stage panel.",
    due: "Queued",
    key: "REL-205",
    owner: "UI",
    priority: "P3",
    title: "Polish stage tooltips",
    track: "Polish",
  },
  workspace_docs: {
    detail: "Refresh mutable workspace docs for the hero labs.",
    due: "Fri",
    key: "REL-187",
    owner: "Docs",
    priority: "P3",
    title: "Refresh workspace docs",
    track: "Docs",
  },
};

const initialBoardState = {
  backlog: ["launch_brief", "bug_triage"],
  in_progress: ["analytics_spec", "workspace_docs"],
  done: ["replay_audit", "tooltips"],
};

const state = {
  board: cloneBoardState(initialBoardState),
  dragCardId: null,
};

const boardElement = document.querySelector("[data-testid='kanban-board']");
const resetButton = document.querySelector("[data-testid='reset-board']");

function cloneBoardState(boardState) {
  return JSON.parse(JSON.stringify(boardState));
}

function readBoardState() {
  return cloneBoardState(state.board);
}

function findCardLocation(cardId) {
  for (const columnId of columnOrder) {
    const index = state.board[columnId].indexOf(cardId);

    if (index >= 0) {
      return { columnId, index };
    }
  }

  return null;
}

function clearDropStates() {
  for (const element of document.querySelectorAll(".dragActive, .dropBefore, .dropAfter")) {
    element.classList.remove("dragActive", "dropBefore", "dropAfter");
    if (element instanceof HTMLElement) {
      delete element.dataset.dropPosition;
    }
  }
}

function moveCard(cardId, nextColumnId, nextIndex = state.board[nextColumnId].length) {
  const location = findCardLocation(cardId);

  if (!location) {
    return;
  }

  if (!columnOrder.includes(nextColumnId)) {
    return;
  }

  const sourceCards = [...state.board[location.columnId]];
  sourceCards.splice(location.index, 1);

  const destinationCards =
    location.columnId === nextColumnId ? sourceCards : [...state.board[nextColumnId]];
  const insertionIndex = Math.max(0, Math.min(nextIndex, destinationCards.length));

  destinationCards.splice(insertionIndex, 0, cardId);

  if (location.columnId === nextColumnId) {
    state.board[nextColumnId] = destinationCards;
  } else {
    state.board[location.columnId] = sourceCards;
    state.board[nextColumnId] = destinationCards;
  }

  render();
}

function createCardElement(cardId, columnId, index) {
  const card = cardsById[cardId];
  const article = document.createElement("article");
  article.className = "card";
  article.draggable = true;
  article.dataset.cardId = cardId;
  article.dataset.testid = `card-${cardId}`;

  article.addEventListener("dragstart", (event) => {
    state.dragCardId = cardId;
    article.classList.add("dragging");
    event.dataTransfer?.setData("text/plain", cardId);
    event.dataTransfer.effectAllowed = "move";
  });

  article.addEventListener("dragend", () => {
    state.dragCardId = null;
    article.classList.remove("dragging");
    clearDropStates();
  });

  article.addEventListener("dragover", (event) => {
    if (!state.dragCardId || state.dragCardId === cardId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rect = article.getBoundingClientRect();
    const dropPosition = event.clientY >= rect.top + rect.height / 2 ? "after" : "before";

    article.dataset.dropPosition = dropPosition;
    article.classList.toggle("dropBefore", dropPosition === "before");
    article.classList.toggle("dropAfter", dropPosition === "after");
  });

  article.addEventListener("dragleave", () => {
    article.classList.remove("dropBefore", "dropAfter");
    delete article.dataset.dropPosition;
  });

  article.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    article.classList.remove("dropBefore", "dropAfter");

    if (state.dragCardId) {
      const dragLocation = findCardLocation(state.dragCardId);
      const rawInsertionIndex = index + (article.dataset.dropPosition === "after" ? 1 : 0);
      const insertionIndex =
        dragLocation && dragLocation.columnId === columnId && dragLocation.index < rawInsertionIndex
          ? rawInsertionIndex - 1
          : rawInsertionIndex;

      moveCard(state.dragCardId, columnId, insertionIndex);
    }

    delete article.dataset.dropPosition;
  });

  const header = document.createElement("div");
  header.className = "cardHeader";
  header.innerHTML = `
    <div class="cardIdentity">
      <span class="cardKey">${card.key}</span>
      <span class="cardPriorityDot cardPriority${card.priority}" aria-hidden="true"></span>
      <span class="cardLabel">${card.track}</span>
    </div>
    <span class="cardMenu" aria-hidden="true">•••</span>
  `;

  const meta = document.createElement("p");
  meta.className = "cardTitle";
  meta.textContent = card.title;

  const summary = document.createElement("p");
  summary.className = "cardSummary";
  summary.textContent = card.detail;

  const footer = document.createElement("div");
  footer.className = "cardFooter";

  const metaRow = document.createElement("div");
  metaRow.className = "cardMetaRow";
  metaRow.innerHTML = `
    <span class="cardAssignee" aria-hidden="true">${card.owner.slice(0, 1)}</span>
    <span class="cardMetaLabel">${card.owner}</span>
    <span class="cardMetaDivider" aria-hidden="true"></span>
    <span class="cardDue">${card.due}</span>
  `;

  footer.append(metaRow);
  article.append(header, meta, summary, footer);
  return article;
}

function render() {
  for (const columnElement of boardElement.querySelectorAll(".columnBody")) {
    const columnId = columnElement.dataset.columnId;
    columnElement.innerHTML = "";

    const cards = state.board[columnId];
    cards.forEach((cardId, index) => {
      columnElement.append(createCardElement(cardId, columnId, index));
    });

    columnElement.classList.toggle("dragActive", false);

    const countElement = document.querySelector(
      `[data-testid='column-count-${columnId.replace("_", "-")}']`,
    );

    if (countElement) {
      countElement.textContent = String(cards.length);
    }
  }
}

resetButton.addEventListener("click", () => {
  state.board = cloneBoardState(initialBoardState);
  render();
});

for (const columnElement of boardElement.querySelectorAll(".columnBody")) {
  const columnId = columnElement.dataset.columnId;

  columnElement.addEventListener("dragover", (event) => {
    event.preventDefault();
    columnElement.classList.add("dragActive");
  });

  columnElement.addEventListener("dragleave", () => {
    columnElement.classList.remove("dragActive");
  });

  columnElement.addEventListener("drop", (event) => {
    event.preventDefault();
    columnElement.classList.remove("dragActive");

    if (state.dragCardId) {
      moveCard(state.dragCardId, columnId, state.board[columnId].length);
    }
  });
}

window.__kanbanLabReady = true;
window.__kanbanReadBoardState = readBoardState;

render();
