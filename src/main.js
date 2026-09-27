import htm from 'htm';
import { h, render } from 'preact';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import './style.css';
import {
    createYTask,
    extractTags,
    parseTodoLine,
    parseTodoText,
    readYTask,
    replaceYArrayValues,
    serializeTodoLine,
    stripTagsFromText
} from './todoModel.js';

const html = htm.bind(h);
const doc = new Y.Doc();
const todoList = doc.getArray('todoItems');
const localPersistence = new IndexeddbPersistence('todo-crdt-storage', doc);
const settingsKey = 'todo-crdt-sync-settings';

let localReady = false;
let localError = '';
let connectionStatus = 'disconnected';
let remoteSyncStatus = '';
let settingsError = '';
let importError = '';
let importStatus = '';
let wsProvider = null;
let wsUrl = '';
let roomName = 'todo-crdt-room';
let newTaskInput = '';
let searchQuery = '';
let selectedProject = '';
let selectedContext = '';
let showSettings = false;
let editingTaskId = null;
let editingTaskText = '';

try {
    const savedSettings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
    wsUrl = typeof savedSettings.url === 'string' ? savedSettings.url : '';
    roomName =
        typeof savedSettings.room === 'string' && savedSettings.room
            ? savedSettings.room
            : roomName;
} catch (error) {
    settingsError = `Could not read sync settings: ${error.message}`;
}

todoList.observeDeep(renderApp);

localPersistence.whenSynced
    .then(() => {
        localReady = true;
        renderApp();
    })
    .catch((error) => {
        localError = `Browser storage is unavailable: ${error.message}`;
        renderApp();
    });

function localDate() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

function getTasks() {
    return todoList.toArray().map((yTask) => ({ ...readYTask(yTask), yTask }));
}

function getFilteredTasks(tasks) {
    const query = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
        if (selectedProject && !task.projects.includes(selectedProject)) return false;
        if (selectedContext && !task.contexts.includes(selectedContext)) return false;
        if (!query) return true;
        return [task.text, ...task.projects, ...task.contexts].some((value) =>
            value.toLowerCase().includes(query)
        );
    });
}

function addTask(event) {
    event?.preventDefault();
    const parsed = parseTodoLine(newTaskInput);
    if (!parsed?.text) return;
    if (!parsed.creationDate) parsed.creationDate = localDate();

    createYTask(parsed, doc, todoList);
    newTaskInput = '';
    renderApp();
    document.getElementById('new-task')?.focus();
}

function toggleTask(task) {
    doc.transact(() => {
        const completed = !task.get('completed');
        task.set('completed', completed);
        task.set('completionDate', completed ? localDate() : null);
    });
}

function deleteTask(task) {
    const index = todoList.toArray().indexOf(task);
    if (index >= 0) doc.transact(() => todoList.delete(index, 1));
}

function setPriority(task, priority) {
    doc.transact(() => task.set('priority', priority || null));
}

function startEditing(task) {
    const item = readYTask(task);
    editingTaskId = item.id;
    editingTaskText = item.text;
    renderApp();
    document.querySelector('.task-edit')?.focus();
}

function saveEdit(task) {
    const text = editingTaskText.trim();
    if (text) {
        const tags = extractTags(text);
        doc.transact(() => {
            const yText = task.get('text');
            if (yText.length) yText.delete(0, yText.length);
            yText.insert(0, text);
            replaceYArrayValues(task.get('projects'), tags.projects);
            replaceYArrayValues(task.get('contexts'), tags.contexts);
        });
    }
    editingTaskId = null;
    editingTaskText = '';
    renderApp();
}

function saveSyncSettings() {
    settingsError = '';
    try {
        localStorage.setItem(
            settingsKey,
            JSON.stringify({ url: wsUrl.trim(), room: roomName.trim() })
        );
    } catch (error) {
        settingsError = `Could not save sync settings: ${error.message}`;
    }
    renderApp();
}

function connectWebSocket() {
    const url = wsUrl.trim();
    const room = roomName.trim();
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch {
        settingsError = 'Enter a valid WebSocket URL.';
        renderApp();
        return;
    }
    if (!['ws:', 'wss:'].includes(parsedUrl.protocol) || !room) {
        settingsError = 'Use a ws:// or wss:// URL and provide a room name.';
        renderApp();
        return;
    }

    saveSyncSettings();
    if (wsProvider) wsProvider.destroy();
    connectionStatus = 'connecting';
    remoteSyncStatus = '';
    try {
        wsProvider = new WebsocketProvider(url, room, doc);
        wsProvider.on('status', ({ status }) => {
            connectionStatus = status;
            renderApp();
        });
        wsProvider.on('sync', (synced) => {
            remoteSyncStatus = synced ? 'up to date' : 'exchanging changes';
            renderApp();
        });
        wsProvider.on('connection-error', () => {
            connectionStatus = 'error';
            settingsError =
                'Could not connect to the sync server. Check the URL and server availability.';
            renderApp();
        });
        wsProvider.on('connection-close', () => {
            if (connectionStatus !== 'error') connectionStatus = 'disconnected';
            renderApp();
        });
    } catch (error) {
        connectionStatus = 'error';
        settingsError = `Could not start sync: ${error.message}`;
        renderApp();
    }
    renderApp();
}

function disconnectWebSocket() {
    if (wsProvider) wsProvider.destroy();
    wsProvider = null;
    connectionStatus = 'disconnected';
    remoteSyncStatus = '';
    renderApp();
}

async function importTodoFile(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    importError = '';
    importStatus = '';
    try {
        const tasks = parseTodoText(await file.text());
        if (!tasks.length) {
            importError = 'The selected file contains no importable tasks.';
        } else {
            doc.transact(() => {
                tasks.forEach((task) => createYTask(task, doc, todoList));
            });
            importStatus = `Imported ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`;
        }
    } catch (error) {
        importError = `Could not import the selected file: ${error.message}`;
    }
    renderApp();
}

function exportTodoFile() {
    const contents = todoList
        .toArray()
        .map((task) => serializeTodoLine(readYTask(task)))
        .join('\n');
    const blob = new Blob([contents ? `${contents}\n` : ''], {
        type: 'text/plain;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'todo.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function TodoApp() {
    const tasks = getTasks();
    const projects = [...new Set(tasks.flatMap((task) => task.projects))].sort();
    const contexts = [...new Set(tasks.flatMap((task) => task.contexts))].sort();
    const visibleTasks = getFilteredTasks(tasks);

    return html`
        <main class="todo-app">
            <header class="app-header">
                <div>
                    <h1>To Do</h1>
                    <p>Local-first tasks with optional CRDT sync</p>
                </div>
                <button class="secondary" type="button" onClick=${() => {
                    showSettings = true;
                    renderApp();
                }}>
                    Settings
                </button>
            </header>

            <div class="file-actions">
                <input
                    id="todo-file"
                    class="visually-hidden"
                    type="file"
                    accept=".txt,text/plain"
                    onChange=${importTodoFile}
                    aria-label="Choose a todo.txt file to import"
                />
                <button class="secondary" type="button" onClick=${() => {
                    document.getElementById('todo-file')?.click();
                }}>Import</button>
                <button class="secondary" type="button" onClick=${exportTodoFile}>Export</button>
            </div>

            <p class="storage-status" role="status">
                ${localError || (localReady ? 'Saved in this browser' : 'Loading browser storage…')}
                ${connectionStatus !== 'disconnected' ? html`<span> · Sync ${connectionStatus}${remoteSyncStatus ? ` — ${remoteSyncStatus}` : ''}</span>` : ''}
                ${settingsError ? html`<span class="error"> · ${settingsError}</span>` : ''}
                ${importStatus ? html`<span> · ${importStatus}</span>` : ''}
                ${importError ? html`<span class="error"> · ${importError}</span>` : ''}
            </p>

            <form class="add-form" onSubmit=${addTask}>
                <input
                    id="new-task"
                    type="text"
                    value=${newTaskInput}
                    onInput=${(event) => {
                        newTaskInput = event.currentTarget.value;
                    }}
                    placeholder="Add a task, +project, or @context"
                    aria-label="New task"
                />
                <button type="submit">Add task</button>
            </form>

            <section class="filters" aria-label="Task filters">
                <input
                    type="search"
                    value=${searchQuery}
                    onInput=${(event) => {
                        searchQuery = event.currentTarget.value;
                        renderApp();
                    }}
                    placeholder="Search tasks"
                    aria-label="Search tasks"
                />
                <select value=${selectedProject} onChange=${(event) => {
                    selectedProject = event.currentTarget.value;
                    renderApp();
                }} aria-label="Filter by project">
                    <option value="">All projects</option>
                    ${projects.map((project) => html`<option value=${project}>+${project}</option>`)}
                </select>
                <select value=${selectedContext} onChange=${(event) => {
                    selectedContext = event.currentTarget.value;
                    renderApp();
                }} aria-label="Filter by context">
                    <option value="">All contexts</option>
                    ${contexts.map((context) => html`<option value=${context}>@${context}</option>`)}
                </select>
            </section>

            ${
                visibleTasks.length
                    ? html`<ul class="task-list">
                    ${visibleTasks.map(
                        (item) => html`
                        <li class=${item.completed ? 'task completed' : 'task'}>
                            <input type="checkbox" checked=${item.completed} onChange=${() => toggleTask(item.yTask)} aria-label="Mark ${item.text} complete" />
                            <div class="task-content">
                                ${
                                    editingTaskId === item.id
                                        ? html`<input
                                        class="task-edit"
                                        type="text"
                                        value=${editingTaskText}
                                        onInput=${(event) => {
                                            editingTaskText = event.currentTarget.value;
                                        }}
                                        onKeyDown=${(event) => {
                                            if (event.key === 'Enter') saveEdit(item.yTask);
                                            if (event.key === 'Escape') {
                                                editingTaskId = null;
                                                editingTaskText = '';
                                                renderApp();
                                            }
                                        }}
                                        onBlur=${() => saveEdit(item.yTask)}
                                        aria-label="Edit task"
                                    />`
                                        : html`<button class="task-text" type="button" onDblClick=${() => startEditing(item.yTask)} title="Double-click to edit">
                                        ${item.priority ? html`<strong>(${item.priority})</strong> ` : ''}${stripTagsFromText(item.text)}
                                    </button>`
                                }
                                <div class="task-tags">
                                    ${item.projects.map((project) => html`<span>+${project}</span>`)}
                                    ${item.contexts.map((context) => html`<span>@${context}</span>`)}
                                </div>
                            </div>
                            <select value=${item.priority || ''} onChange=${(event) => setPriority(item.yTask, event.currentTarget.value)} aria-label="Priority for ${item.text}">
                                <option value="">No priority</option>
                                ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((priority) => html`<option value=${priority}>(${priority})</option>`)}
                            </select>
                            <button class="delete" type="button" onClick=${() => deleteTask(item.yTask)} aria-label="Delete ${item.text}">Delete</button>
                        </li>
                    `
                    )}
                </ul>`
                    : html`<p class="empty-state">${tasks.length ? 'No tasks match these filters.' : 'No tasks yet. Add one above to get started.'}</p>`
            }

            ${
                showSettings
                    ? html`
                <div class="modal-backdrop" onClick=${(event) => {
                    if (event.target === event.currentTarget) {
                        showSettings = false;
                        renderApp();
                    }
                }}>
                    <section class="settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
                        <h2 id="settings-title">Settings</h2>
                        <section aria-labelledby="sync-settings-title">
                            <h3 id="sync-settings-title">Sync settings</h3>
                            <p>Your tasks are stored on this device without any sync configuration. Connect a Yjs WebSocket server only if you want to share this document across devices.</p>
                            <label>
                                WebSocket URL
                                <input type="text" value=${wsUrl} onInput=${(event) => {
                                    wsUrl = event.currentTarget.value;
                                }} placeholder="ws://localhost:1234" />
                            </label>
                            <label>
                                Shared room name
                                <input type="text" value=${roomName} onInput=${(event) => {
                                    roomName = event.currentTarget.value;
                                }} />
                            </label>
                            ${settingsError ? html`<p class="error" role="alert">${settingsError}</p>` : ''}
                            <div class="settings-actions">
                                <button type="button" onClick=${connectWebSocket}>Connect</button>
                                <button class="secondary" type="button" onClick=${disconnectWebSocket}>Disconnect</button>
                                <button class="secondary" type="button" onClick=${() => {
                                    saveSyncSettings();
                                    showSettings = false;
                                    renderApp();
                                }}>Close</button>
                            </div>
                        </section>
                    </section>
                </div>
            `
                    : ''
            }
        </main>
    `;
}

function renderApp() {
    render(html`<${TodoApp} />`, document.getElementById('app'));
}

renderApp();
