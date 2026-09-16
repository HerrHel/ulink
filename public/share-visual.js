// public/share-visual.js
// 深度重构：完全采用主站首屏 (hero-visual.js) 的原生星系网络美学，消除割裂感

window.renderShareVisual = function renderShareVisual(canvas, options = {}) {
    let { concept = 2, onStateChange } = options;
    const ctx = canvas.getContext('2d', { alpha: false });
    let rafId;
    let isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    let W = canvas.offsetWidth;
    let H = canvas.offsetHeight;
    let dpr = window.devicePixelRatio || 2;

    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            W = entry.contentRect.width;
            H = entry.contentRect.height;
            canvas.width = W * dpr;
            canvas.height = H * dpr;
            ctx.scale(dpr, dpr);
        }
    });
    resizeObserver.observe(canvas);

    // --- 设计系统变量 (完美对齐首屏) ---
    const BRAND = isDark ? '240,74,138' : '18,46,138';     
    const ACCENT = isDark ? '240,74,138' : '59,130,246';   
    const TEAL = isDark ? '16,185,129' : '16,185,129';
    const BG = isDark ? '#25252B' : '#FDFBF9'; // 沉浸白/暗色
    const TEXT = isDark ? '#EEE9E2' : '#2C2824';
    const MUTED = isDark ? '#9B968E' : '#6A6660';

    // 生成光晕精灵图
    function makeGlow(rgb, size) {
        let s = document.createElement('canvas');
        s.width = s.height = size;
        let g = s.getContext('2d');
        let half = size / 2;
        let grad = g.createRadialGradient(half, half, 0, half, half, half);
        grad.addColorStop(0, 'rgba(' + rgb + ', 0.9)');
        grad.addColorStop(0.2, 'rgba(' + rgb + ', 0.4)');
        grad.addColorStop(1, 'rgba(' + rgb + ', 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        return s;
    }
    const spriteBrand = makeGlow(BRAND, 64);
    const spriteAccent = makeGlow(ACCENT, 64);
    const spriteTeal = makeGlow(TEAL, 64);

    let state = 'idle'; // idle, forking, forked
    let forkProgress = 0;
    
    // 共享集群 (左侧)
    const publicHub = { x: W * 0.35, y: H * 0.5, flash: 0 };
    const publicNodes = Array.from({length: 6}, (_, i) => ({
        angle: (Math.PI * 2 / 6) * i,
        speed: 0.2 + Math.random() * 0.2,
        r: 60 + Math.random() * 40,
        size: 2 + Math.random() * 2,
        type: Math.random() > 0.5 ? 'brand' : (Math.random() > 0.5 ? 'accent' : 'teal')
    }));

    // 本地节点 (右侧)
    const localHub = { x: W * 0.7, y: H * 0.5, flash: 0 };
    const localNodes = []; // forked 后生成

    // 数据脉冲
    let pulses = [];

    // 交互
    const clickHandler = () => {
        if (state === 'idle') {
            state = 'forking';
            if(onStateChange) onStateChange('forking');
            // 发射大量脉冲
            for(let i=0; i<15; i++) {
                pulses.push({
                    progress: -Math.random() * 0.5,
                    speed: 0.015 + Math.random() * 0.015,
                    length: 0.05 + Math.random() * 0.1,
                    type: Math.random() > 0.5 ? 'brand' : 'teal'
                });
            }
        } else if (state === 'forked') {
            state = 'idle';
            forkProgress = 0;
            localNodes.length = 0;
            pulses = [];
            if(onStateChange) onStateChange('idle');
        }
    };
    canvas.addEventListener('click', clickHandler);

    let lastT = 0;

    function draw(t) {
        if (!lastT) lastT = t;
        const dt = (t - lastT) / 1000;
        lastT = t;

        ctx.fillStyle = BG;
        ctx.fillRect(0, 0, W, H);

        publicHub.x = W * 0.35; publicHub.y = H * 0.5;
        localHub.x = W * 0.7; localHub.y = H * 0.5;

        // 绘制共享集群的轨道与节点
        ctx.lineWidth = 1;
        
        publicNodes.forEach(nd => {
            nd.angle += nd.speed * dt;
            const nx = publicHub.x + Math.cos(nd.angle) * nd.r;
            const ny = publicHub.y + Math.sin(nd.angle) * nd.r * 0.88;

            // 连接线
            ctx.beginPath();
            ctx.moveTo(publicHub.x, publicHub.y);
            ctx.lineTo(nx, ny);
            ctx.strokeStyle = 'rgba(' + (nd.type==='teal'?TEAL:BRAND) + ', 0.15)';
            ctx.stroke();

            // 节点光晕
            const sprite = nd.type === 'teal' ? spriteTeal : (nd.type === 'accent' ? spriteAccent : spriteBrand);
            const glowR = nd.size * 6;
            ctx.drawImage(sprite, nx - glowR/2, ny - glowR/2, glowR, glowR);
            
            // 节点实心
            ctx.beginPath();
            ctx.arc(nx, ny, nd.size, 0, Math.PI*2);
            ctx.fillStyle = '#fff';
            ctx.fill();
        });

        // 绘制中心 Hub
        function drawHub(hx, hy, label, isActive) {
            const pulse = isActive ? 1 + 0.1 * Math.sin(t / 200) : 1;
            const glowR = 30 * pulse;
            
            let grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, glowR);
            grad.addColorStop(0, 'rgba(' + BRAND + ', ' + (isActive ? 0.3 : 0.1) + ')');
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(hx, hy, glowR, 0, Math.PI*2); ctx.fill();

            ctx.beginPath();
            ctx.arc(hx, hy, 16, 0, Math.PI*2);
            ctx.fillStyle = isDark ? '#1A1A1D' : '#fff';
            ctx.shadowColor = 'rgba(' + BRAND + ', 0.15)';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowColor = 'transparent';

            ctx.strokeStyle = 'rgba(' + BRAND + ', 0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Hub 内芯
            ctx.beginPath();
            ctx.arc(hx, hy, 6, 0, Math.PI*2);
            ctx.fillStyle = 'rgba(' + BRAND + ', 0.8)';
            ctx.fill();

            // Label
            ctx.fillStyle = TEXT;
            ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(label, hx, hy + 45);
        }

        // Fork 连线与脉冲
        if (state !== 'idle') {
            if (state === 'forking') {
                forkProgress += 0.012;
                if (forkProgress >= 1) {
                    forkProgress = 1;
                    state = 'forked';
                    if(onStateChange) onStateChange('forked');
                    // 生成本地克隆节点
                    publicNodes.forEach(nd => {
                        localNodes.push({ ...nd });
                    });
                }
            }

            // 主干线
            ctx.beginPath();
            ctx.moveTo(publicHub.x, publicHub.y);
            const lineEndX = publicHub.x + (localHub.x - publicHub.x) * forkProgress;
            ctx.lineTo(lineEndX, publicHub.y);
            ctx.strokeStyle = 'rgba(' + BRAND + ', 0.3)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // 脉冲
            if (state === 'forking') {
                pulses.forEach(p => {
                    p.progress += p.speed;
                    if (p.progress > 0 && p.progress < 1) {
                        const px = publicHub.x + (localHub.x - publicHub.x) * p.progress;
                        const len = (localHub.x - publicHub.x) * p.length;
                        
                        let grad = ctx.createLinearGradient(px - len, publicHub.y, px, publicHub.y);
                        grad.addColorStop(0, 'transparent');
                        grad.addColorStop(1, 'rgba(' + (p.type==='teal'?TEAL:BRAND) + ', 1)');
                        
                        ctx.beginPath();
                        ctx.moveTo(Math.max(publicHub.x, px - len), publicHub.y);
                        ctx.lineTo(px, publicHub.y);
                        ctx.strokeStyle = grad;
                        ctx.lineWidth = 3;
                        ctx.lineCap = 'round';
                        ctx.stroke();
                        ctx.lineCap = 'butt';
                    }
                });
            }
        }

        // 绘制本地集群的轨道与节点 (Forked 之后)
        if (state === 'forked') {
            localNodes.forEach(nd => {
                nd.angle += nd.speed * dt;
                const nx = localHub.x + Math.cos(nd.angle) * nd.r;
                const ny = localHub.y + Math.sin(nd.angle) * nd.r * 0.88;

                ctx.beginPath();
                ctx.moveTo(localHub.x, localHub.y);
                ctx.lineTo(nx, ny);
                ctx.strokeStyle = 'rgba(' + (nd.type==='teal'?TEAL:BRAND) + ', 0.15)';
                ctx.lineWidth = 1;
                ctx.stroke();

                const sprite = nd.type === 'teal' ? spriteTeal : (nd.type === 'accent' ? spriteAccent : spriteBrand);
                const glowR = nd.size * 6;
                ctx.drawImage(sprite, nx - glowR/2, ny - glowR/2, glowR, glowR);
                
                ctx.beginPath();
                ctx.arc(nx, ny, nd.size, 0, Math.PI*2);
                ctx.fillStyle = '#fff';
                ctx.fill();
            });
        }

        drawHub(publicHub.x, publicHub.y, 'SHARED CLUSTER', true);
        drawHub(localHub.x, localHub.y, '@YOU (LOCAL)', state === 'forked');

        rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return {
        destroy: () => {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            canvas.removeEventListener('click', clickHandler);
        }
    };
};

// Auto-mount for landing page (index.html)
(function() {
    if (typeof document !== 'undefined' && document.getElementById('share-canvas') && !window.__shareVisualMounted) {
        window.__shareVisualMounted = true;
        
        let concept = 2; // Fixed to unified aesthetic
        
        const canvas = document.getElementById('share-canvas');
        
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!window.__sv_instance) {
                        window.__sv_instance = window.renderShareVisual(canvas, { concept });
                    }
                }
            });
        }, { threshold: 0.1 });
        observer.observe(canvas);
    }
})();
