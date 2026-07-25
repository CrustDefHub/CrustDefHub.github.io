/*
 * 发布版性能补丁：保留 mainobf.js 的既有功能，只替换震源机制图层的加载流程。
 * 数据只请求一次；仅渲染当前视图附近的点；Marker 分帧创建，避免冻结地图。
 */
(() => {
  const DATA_URL = 'data/beach_ball.json';
  let data = null;
  let loading = null;
  let renderToken = 0;
  let moveTimer = null;
  const iconCache = new Map();

  const status = (message, error = false) => {
    const element = document.getElementById('beachballStatus');
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('is-error', error);
  };

  const getData = async () => {
    if (data) return data;
    if (!loading) {
      status('正在加载震源机制数据…');
      loading = fetch(DATA_URL)
        .then(response => {
          if (!response.ok) throw new Error(`请求失败：${response.status}`);
          return response.json();
        })
        .then(rows => {
          data = rows.map(row => ({
            ...row,
            lon: Number(row.LON), lat: Number(row.LAT), strike: Number(row.STRIKE),
            dip: Number(row.DIP), rake: Number(row.RAKE), magnitude: Number(row.MW),
          })).filter(row => Number.isFinite(row.lon) && Number.isFinite(row.lat));
          return data;
        })
        .catch(error => { loading = null; throw error; });
    }
    return loading;
  };

  const getIcon = row => {
    const size = Math.max(16, Math.min(40, row.magnitude * 4));
    const key = [row.strike.toFixed(1), row.dip.toFixed(1), row.rake.toFixed(1), size].join('|');
    if (!iconCache.has(key)) {
      const image = window.createBeachballIcon(row.strike, row.dip, row.rake, size, Math.round(size * 2));
      iconCache.set(key, L.icon({
        iconUrl: image, iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
      }));
    }
    return iconCache.get(key);
  };

  const popup = row => `<div class="beachball-popup"><strong>${row.EVENT_ID || 'Event'}</strong><br>
    日期：${row.DATE || '—'}<br>震级：M${row.magnitude || '—'}　深度：${row.DEPTH || '—'} km<br>
    走向/倾角/滑动角：${row.strike}° / ${row.dip}° / ${row.rake}°</div>`;

  const render = map => {
    const group = window.beachballLayerGroup;
    const toggle = document.getElementById('toggleBeachball');
    const token = ++renderToken;
    group.clearLayers();
    if (!toggle.checked || !data) return;

    const bounds = map.getBounds().pad(0.2);
    const visible = data.filter(row => bounds.contains([row.lat, row.lon]));
    status(`显示 ${visible.length} / ${data.length} 个机制解`);
    let cursor = 0;
    const batch = () => {
      if (token !== renderToken) return;
      const end = Math.min(cursor + 24, visible.length);
      for (; cursor < end; cursor += 1) {
        const row = visible[cursor];
        L.marker([row.lat, row.lon], { icon: getIcon(row), keyboard: false })
          .addTo(group)
          .bindPopup(popup(row), { maxWidth: 280 });
      }
      if (cursor < visible.length) requestAnimationFrame(batch);
    };
    requestAnimationFrame(batch);
  };

  const enable = async map => {
    const group = window.beachballLayerGroup;
    group.clearLayers();
    if (!document.getElementById('toggleBeachball').checked) {
      status('未显示');
      return;
    }
    try {
      await getData();
      render(map);
    } catch (error) {
      status('加载失败，请重试', true);
      console.warn('Beachball 图层提示:', error.message);
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const group = window.beachballLayerGroup;
    const map = group && group._map;
    const oldToggle = document.getElementById('toggleBeachball');
    if (!map || !oldToggle || typeof window.createBeachballIcon !== 'function') return;

    // mainobf.js 已绑定旧监听器；替换开关节点以移除它，避免旧逻辑重复请求和重绘。
    const toggle = oldToggle.cloneNode(true);
    oldToggle.replaceWith(toggle);
    toggle.addEventListener('change', () => enable(map));
    map.on('moveend', () => {
      if (!data || !toggle.checked) return;
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => render(map), 120);
    });
    enable(map);
  });
})();
