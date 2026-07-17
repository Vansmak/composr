// Mobile container navigation: grouped by whatever the existing group-by
// selector says (None/Compose/Host/Tags - #group-filter / #group-filter-mobile,
// same selector the desktop grid and table already read), tap a group to see
// its containers, tap a container to see commands and info (via the existing
// container popup, extended to also show Start/Stop/Restart and the stack
// name). A dedicated flow built for phone widths, not the desktop grid or
// table adapted down - confirmed across several rounds of real-device
// testing that shrinking either doesn't hold up at that width.

let mobileDrillGroup = null; // the group mode we're currently drilled into ('stack'/'host'/'tag')
let mobileDrillKey = null;   // the specific group name selected within that mode, or null = top-level list

function mobileEscape(value) {
    if (window.escapeHtml) return window.escapeHtml(value);
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
}

function getMobileGroupMode() {
    const el = document.getElementById('group-filter');
    const elMobile = document.getElementById('group-filter-mobile');
    return (el && el.value) || (elMobile && elMobile.value) || 'none';
}

function mobileGroupKeyFn(group) {
    if (group === 'host') return c => c.host_display || c.host || 'local';
    if (group === 'tag') return c => (c.tags && c.tags.length) ? c.tags[0] : 'Untagged';
    return c => window.extractStackName(c); // 'stack' and the default fallback
}

function renderMobileDrillDown(containers) {
    const containersList = document.getElementById('containers-list');
    if (!containersList) return;
    containersList.innerHTML = '';
    containersList.classList.add('mobile-drilldown-active');

    const group = getMobileGroupMode();
    if (group !== mobileDrillGroup) {
        // Grouping mode changed since we last rendered (e.g. the dropdown
        // was switched) - start that mode fresh rather than keeping a
        // selection that belonged to the previous mode's groups.
        mobileDrillGroup = group;
        mobileDrillKey = null;
    }

    if (group === 'none') {
        renderMobileFlatList(containers, containersList);
        return;
    }

    const keyFn = mobileGroupKeyFn(group);

    // The selected group may have lost all its containers since it was
    // picked (removed, or filtered out by search/status) - fall back to the
    // group list rather than rendering an empty detail screen.
    if (mobileDrillKey !== null && !containers.some(c => keyFn(c) === mobileDrillKey)) {
        mobileDrillKey = null;
    }

    if (mobileDrillKey === null) {
        renderMobileGroupList(containers, containersList, keyFn);
    } else {
        renderMobileGroupContainers(containers, containersList, keyFn, mobileDrillKey, group);
    }
}

function renderMobileGroupList(containers, container, keyFn) {
    const groups = {};
    containers.forEach(c => {
        const key = keyFn(c);
        (groups[key] = groups[key] || []).push(c);
    });

    const wrap = document.createElement('div');
    wrap.className = 'mobile-stack-list';

    Object.keys(groups).sort().forEach(key => {
        const group = groups[key];
        const running = group.filter(c => c.status === 'running').length;

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'mobile-stack-row';
        row.innerHTML = `
            <span class="mobile-stack-row-name">${mobileEscape(key)}</span>
            <span class="mobile-stack-row-meta">${running}/${group.length} running</span>
            <span class="mobile-row-chevron">›</span>
        `;
        row.addEventListener('click', () => {
            mobileDrillKey = key;
            renderMobileDrillDown(window.lastContainerData || containers);
        });
        wrap.appendChild(row);
    });

    container.appendChild(wrap);
}

function renderMobileGroupContainers(containers, container, keyFn, key, groupMode) {
    const group = containers.filter(c => keyFn(c) === key);

    const header = document.createElement('div');
    header.className = 'mobile-drilldown-header';
    header.innerHTML = `
        <button type="button" class="btn btn-sm btn-secondary mobile-back-btn">← Back</button>
        <h3>${mobileEscape(key)}</h3>
    `;
    header.querySelector('.mobile-back-btn').addEventListener('click', () => {
        mobileDrillKey = null;
        renderMobileDrillDown(window.lastContainerData || containers);
    });
    container.appendChild(header);

    // Omit whichever field the group is already keyed on - it's redundant
    // with the header we just rendered above every row.
    const wrap = document.createElement('div');
    wrap.className = 'mobile-container-list';
    group.forEach(c => {
        wrap.appendChild(renderMobileContainerRow(c, {
            showHost: groupMode !== 'host',
            showStack: groupMode !== 'stack',
        }));
    });
    container.appendChild(wrap);
}

function renderMobileFlatList(containers, container) {
    const wrap = document.createElement('div');
    wrap.className = 'mobile-container-list';
    containers.forEach(c => {
        wrap.appendChild(renderMobileContainerRow(c, { showHost: true, showStack: true }));
    });
    container.appendChild(wrap);
}

function renderMobileContainerRow(c, { showHost = true, showStack = true } = {}) {
    const health = window.getContainerHealth ? window.getContainerHealth(c) : { level: 'unknown' };
    const uptimeDisplay = c.uptime && c.uptime.display ? c.uptime.display : '';
    const hostDisplay = c.host_display || c.host || 'local';

    const metaParts = [];
    if (showStack) metaParts.push(mobileEscape(window.extractStackName(c)));
    if (showHost) metaParts.push(mobileEscape(hostDisplay));
    if (uptimeDisplay) metaParts.push(mobileEscape(uptimeDisplay));

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'mobile-container-row';
    row.innerHTML = `
        <div class="mobile-container-row-main">
            <span class="mobile-container-row-name">${mobileEscape(c.name)}</span>
            <span class="health-${health.level}">${mobileEscape(c.status)}</span>
        </div>
        ${metaParts.length ? `<div class="mobile-container-row-meta">${metaParts.join(' · ')}</div>` : ''}
    `;
    row.addEventListener('click', () => {
        if (window.showContainerPopup) {
            window.showContainerPopup(c.id, c.name, c.host || 'local');
        }
    });
    return row;
}

window.renderMobileDrillDown = renderMobileDrillDown;
