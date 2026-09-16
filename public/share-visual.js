// public/share-visual.js
// 基于主站「娱乐」(social) 分类图标的拓扑结构展开设计

window.renderShareVisual = function renderShareVisual(canvas, options = {}) {
    let { onStateChange } = options;
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

    const BRAND = isDark ? '240,74,138' : '18,46,138';     
    const TEAL = isDark ? '16,185,129' : '16,185,129';
    const BG = isDark ? '#25252B' : '#FDFBF9'; 
    const TEXT = isDark ? '#EEE9E2' : '#2C2824';

    // 娱乐分类图标(Social)的拓扑特征：1个主用户节点 + 3个卫星节点
    const SATELLITE_ANGLES = [ -Math.PI * 0.8, -Math.PI * 0.2, Math.PI * 0.35 ];
    
    let state = 'idle'; 
    let forkProgress = 0;
    
    // 脉冲数组
    let pulses = [];

    // 绘制用户剪影 (参考 social-icon 内部结构)
    function drawUserAvatar(x, y, radius, color, alpha) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(radius/20, radius/20);
        
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        // Head
        ctx.beginPath();
        ctx.arc(0, -4, 5, 0, Math.PI*2);
        ctx.fill();
        
        // Body (shoulders)
        ctx.beginPath();
        ctx.arc(0, 12, 10, Math.PI, Math.PI*2);
        ctx.fill();
        
        ctx.restore();
    }

    // 交互逻辑
    const clickHandler = () => {
        if (state === 'idle') {
            state = 'forking';
            if(onStateChange) onStateChange('forking');
            // 生成主干脉冲
            for(let i=0; i<8; i++) {
                pulses.push({
                    type: 'trunk',
                    progress: -Math.random() * 0.4,
                    speed: 0.015 + Math.random() * 0.01,
                    length: 0.1 + Math.random() * 0.1
                });
            }
        } else if (state === 'forked') {
            state = 'idle';
            forkProgress = 0;
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

        const leftX = W * 0.35;
        const centerY = H * 0.5;
        const rightX = W * 0.7;
        
        const mainRadius = 32;
        const satRadius = 12;
        const orbitRadius = 75;

        // 呼吸效果
        const breath = 1 + 0.05 * Math.sin(t / 400);
        const floatY = Math.sin(t / 600) * 4;

        // --- 1. 绘制连线 ---
        
        // 左侧卫星连线
        SATELLITE_ANGLES.forEach(angle => {
            const sx = leftX + Math.cos(angle) * orbitRadius * breath;
            const sy = centerY + floatY + Math.sin(angle) * orbitRadius * breath;
            ctx.beginPath();
            ctx.moveTo(leftX, centerY + floatY);
            ctx.lineTo(sx, sy);
            ctx.strokeStyle = `rgba(${BRAND}, 0.2)`;
            ctx.lineWidth = 2;
            ctx.stroke();
        });

        // Fork 主干线
        if (state !== 'idle') {
            if (state === 'forking') {
                forkProgress += 0.015;
                if (forkProgress >= 1) {
                    forkProgress = 1;
                    state = 'forked';
                    if(onStateChange) onStateChange('forked');
                }
            }

            const currentRightX = leftX + (rightX - leftX) * forkProgress;
            ctx.beginPath();
            ctx.moveTo(leftX, centerY + floatY);
            ctx.lineTo(currentRightX, centerY + floatY);
            ctx.strokeStyle = `rgba(${BRAND}, 0.3)`;
            ctx.lineWidth = 2;
            ctx.stroke();

            // 主干脉冲
            pulses.forEach(p => {
                if (p.type === 'trunk') {
                    p.progress += p.speed;
                    if (p.progress > 0 && p.progress < 1) {
                        const px = leftX + (rightX - leftX) * p.progress;
                        const len = (rightX - leftX) * p.length;
                        let grad = ctx.createLinearGradient(px - len, centerY + floatY, px, centerY + floatY);
                        grad.addColorStop(0, 'transparent');
                        grad.addColorStop(1, `rgba(${TEAL}, 1)`);
                        ctx.beginPath();
                        ctx.moveTo(Math.max(leftX, px - len), centerY + floatY);
                        ctx.lineTo(px, centerY + floatY);
                        ctx.strokeStyle = grad;
                        ctx.lineWidth = 3;
                        ctx.lineCap = 'round';
                        ctx.stroke();
                        ctx.lineCap = 'butt';
                    }
                }
            });
        }

        // 右侧卫星连线 (Forked)
        let rightBreath = 1;
        if (state === 'forked') {
            rightBreath = 1 + 0.05 * Math.sin(t / 400 + Math.PI);
            SATELLITE_ANGLES.forEach(angle => {
                const sx = rightX + Math.cos(angle) * orbitRadius * rightBreath;
                const sy = centerY + floatY + Math.sin(angle) * orbitRadius * rightBreath;
                ctx.beginPath();
                ctx.moveTo(rightX, centerY + floatY);
                ctx.lineTo(sx, sy);
                ctx.strokeStyle = `rgba(${TEAL}, 0.2)`;
                ctx.lineWidth = 2;
                ctx.stroke();
            });
        }

        // --- 2. 绘制节点 ---

        // 绘制节点的通用函数
        function drawNode(x, y, r, colorStr, hasAvatar) {
            // 外圈光晕
            let grad = ctx.createRadialGradient(x, y, r, x, y, r * 2.5);
            grad.addColorStop(0, `rgba(${colorStr}, 0.15)`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(x, y, r * 2.5, 0, Math.PI*2); ctx.fill();

            // 节点本体
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI*2);
            ctx.fillStyle = BG;
            ctx.fill();
            
            ctx.lineWidth = 2;
            ctx.strokeStyle = `rgba(${colorStr}, 0.6)`;
            ctx.stroke();

            if (hasAvatar) {
                drawUserAvatar(x, y, r, colorStr, 0.8);
            } else {
                // 卫星节点内芯
                ctx.beginPath();
                ctx.arc(x, y, r * 0.3, 0, Math.PI*2);
                ctx.fillStyle = `rgba(${colorStr}, 0.8)`;
                ctx.fill();
            }
        }

        // 左侧卫星
        SATELLITE_ANGLES.forEach(angle => {
            const sx = leftX + Math.cos(angle) * orbitRadius * breath;
            const sy = centerY + floatY + Math.sin(angle) * orbitRadius * breath;
            drawNode(sx, sy, satRadius, BRAND, false);
        });

        // 左侧主节点
        drawNode(leftX, centerY + floatY, mainRadius, BRAND, true);
        ctx.fillStyle = TEXT; ctx.font = '600 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('PUBLIC ORIGIN', leftX, centerY + floatY + mainRadius + 24);

        // 右侧节点
        if (state !== 'idle') {
            // 右侧主节点
            const rightAlpha = state === 'forking' ? forkProgress : 1;
            ctx.globalAlpha = rightAlpha;
            drawNode(rightX, centerY + floatY, mainRadius, TEAL, true);
            ctx.fillStyle = TEXT; ctx.fillText('@YOU (LOCAL)', rightX, centerY + floatY + mainRadius + 24);
            ctx.globalAlpha = 1;

            // 右侧卫星
            if (state === 'forked') {
                SATELLITE_ANGLES.forEach(angle => {
                    const sx = rightX + Math.cos(angle) * orbitRadius * rightBreath;
                    const sy = centerY + floatY + Math.sin(angle) * orbitRadius * rightBreath;
                    drawNode(sx, sy, satRadius, TEAL, false);
                });
            }
        }

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

// Auto-mount
(function() {
    if (typeof document !== 'undefined' && document.getElementById('share-canvas') && !window.__shareVisualMounted) {
        window.__shareVisualMounted = true;
        const canvas = document.getElementById('share-canvas');
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!window.__sv_instance) {
                        window.__sv_instance = window.renderShareVisual(canvas, {});
                    }
                }
            });
        }, { threshold: 0.1 });
        observer.observe(canvas);
    }
})();
