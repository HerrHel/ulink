
// public/share-visual.js
// 全新高定版 - 贴合「与链」产品灵魂的双星概念

window.renderShareVisual = function renderShareVisual(canvas, options = {}) {
    let { concept = 1, onStateChange } = options;
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

    const m = { x: -1000, y: -1000, isDown: false };
    let isHovered = false;

    function updateMouse(e) {
        const rect = canvas.getBoundingClientRect();
        m.x = e.clientX - rect.left;
        m.y = e.clientY - rect.top;
    }
    canvas.addEventListener('mousemove', (e) => { updateMouse(e); isHovered = true; });
    canvas.addEventListener('mouseleave', () => { isHovered = false; m.x = -1000; });
    canvas.addEventListener('mousedown', () => { m.isDown = true; });
    canvas.addEventListener('mouseup', () => { m.isDown = false; });

    let stopFn = () => {};

    if (concept == 1 || concept == '1') {
        stopFn = startStarNet();
    } else {
        stopFn = startFiberBranch();
    }

    const observer = new MutationObserver(() => {
        isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return {
        destroy() {
            cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            observer.disconnect();
            stopFn();
        }
    };

    // ==========================================
    // 1. 全息星网 (Holographic Star-Net)
    // ==========================================
    function startStarNet() {
        let state = 'idle'; 
        let t = 0;
        let forkProgress = 0;
        
        function genNodes(count, r) {
            let pts = [];
            for(let i=0; i<count; i++) {
                let u = Math.random(), v = Math.random();
                let theta = 2 * Math.PI * u;
                let phi = Math.acos(2 * v - 1);
                let radius = r * Math.cbrt(Math.random());
                pts.push({
                    x: radius * Math.sin(phi) * Math.cos(theta),
                    y: radius * Math.sin(phi) * Math.sin(theta),
                    z: radius * Math.cos(phi),
                    size: Math.random() * 2 + 0.5,
                    phase: Math.random() * Math.PI * 2
                });
            }
            return pts;
        }

        const originNodes = genNodes(35, 75);
        const bgStars = Array.from({length: 80}, () => ({
            x: Math.random(), y: Math.random(),
            size: Math.random()*1.5,
            speedX: (Math.random()-0.5)*0.15,
            speedY: (Math.random()-0.5)*0.15,
            alpha: Math.random()
        }));

        let particles = [];
        let angleX = 0;
        let angleY = 0;

        const clickHandler = () => {
            if(state === 'idle') {
                state = 'forking';
                forkProgress = 0;
                if(onStateChange) onStateChange('forking');
                for(let i=0; i<50; i++) {
                    particles.push({
                        delay: Math.random() * 25,
                        progress: 0,
                        speed: 0.04 + Math.random() * 0.04
                    });
                }
            }
        };
        canvas.addEventListener('click', clickHandler);

        function draw() {
            t += 1;
            const bg = isDark ? '#0D0D0F' : '#F5EFEA';
            const originColor = isDark ? '56, 189, 248' : '18, 46, 138'; // Sky Blue / Deep Blue
            const localColor = isDark ? '16, 185, 129' : '16, 185, 129'; // Emerald
            const textColor = isDark ? '#FFF' : '#333';
            
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, W, H);
            
            // bg grid
            ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.02)';
            ctx.lineWidth = 1;
            for(let i=0; i<W; i+=60) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke(); }
            for(let i=0; i<H; i+=60) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke(); }

            // bg stars
            ctx.fillStyle = isDark ? '#FFF' : '#000';
            bgStars.forEach(s => {
                s.x += s.speedX / W; s.y += s.speedY / H;
                if(s.x<0) s.x=1; if(s.x>1) s.x=0;
                if(s.y<0) s.y=1; if(s.y>1) s.y=0;
                ctx.globalAlpha = (Math.sin(t*0.01 + s.alpha*10) * 0.5 + 0.5) * (isDark?0.5:0.25);
                ctx.beginPath(); ctx.arc(s.x*W, s.y*H, s.size, 0, Math.PI*2); ctx.fill();
            });
            ctx.globalAlpha = 1;

            const originCenter = { x: W * 0.32, y: H * 0.5 };
            const localCenter = { x: W * 0.68, y: H * 0.5 };

            // Anchors
            ctx.shadowBlur = 20;
            ctx.shadowColor = `rgba(${originColor}, 0.7)`;
            ctx.fillStyle = `rgb(${originColor})`;
            ctx.beginPath(); ctx.arc(originCenter.x, originCenter.y, 4, 0, Math.PI*2); ctx.fill();
            
            ctx.shadowColor = `rgba(${localColor}, 0.7)`;
            ctx.fillStyle = `rgb(${localColor})`;
            ctx.beginPath(); ctx.arc(localCenter.x, localCenter.y, 4, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = textColor; ctx.font = '500 11px "Inter", sans-serif'; ctx.textAlign = 'center';
            ctx.globalAlpha = 0.5;
            ctx.fillText('PUBLIC ORIGIN STAR-NET', originCenter.x, originCenter.y + 130);
            ctx.fillText('@YOU (LOCAL VAULT)', localCenter.x, localCenter.y + 130);
            ctx.globalAlpha = 1;

            // 3D Rot
            let targetSpeed = isHovered ? 0.025 : 0.005;
            angleY += targetSpeed; angleX += targetSpeed * 0.5;
            let cosY = Math.cos(angleY), sinY = Math.sin(angleY);
            let cosX = Math.cos(angleX), sinX = Math.sin(angleX);

            function drawConstellation(center, colorRGB, opacityScale) {
                let projNodes = [];
                for(let n of originNodes) {
                    let x1 = n.x * cosY - n.z * sinY, z1 = n.z * cosY + n.x * sinY;
                    let y1 = n.y * cosX - z1 * sinX, z2 = z1 * cosX + n.y * sinX;
                    let scale = 250 / (250 + z2);
                    projNodes.push({ x: center.x + x1 * scale, y: center.y + y1 * scale, scale: scale, orig: n, z: z2 });
                }
                projNodes.sort((a,b) => b.z - a.z);

                ctx.lineWidth = 1.2;
                for(let i=0; i<projNodes.length; i++) {
                    for(let j=i+1; j<projNodes.length; j++) {
                        let p1 = projNodes[i], p2 = projNodes[j];
                        let dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
                        if(dist < 55) {
                            ctx.strokeStyle = `rgba(${colorRGB}, ${(1 - dist/55) * 0.45 * opacityScale})`;
                            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
                        }
                    }
                }
                for(let p of projNodes) {
                    let glow = Math.sin(t*0.05 + p.orig.phase) * 0.5 + 0.5;
                    ctx.fillStyle = `rgba(${colorRGB}, ${(0.5 + glow*0.5) * opacityScale})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.orig.size * p.scale, 0, Math.PI*2); ctx.fill();
                }
            }

            drawConstellation(originCenter, originColor, 1);

            if (state === 'forking') {
                forkProgress += 0.015;
                
                let tetherEnd = {
                    x: originCenter.x + (localCenter.x - originCenter.x) * Math.min(1, forkProgress * 2),
                    y: originCenter.y + (localCenter.y - originCenter.y) * Math.min(1, forkProgress * 2)
                };
                
                ctx.strokeStyle = `rgba(${localColor}, 0.6)`;
                ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.lineDashOffset = -t * 3;
                ctx.beginPath(); ctx.moveTo(originCenter.x, originCenter.y); ctx.lineTo(tetherEnd.x, tetherEnd.y); ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = `rgb(${localColor})`;
                ctx.shadowBlur = 15; ctx.shadowColor = `rgb(${localColor})`;
                particles.forEach(p => {
                    if (forkProgress * 100 > p.delay) {
                        p.progress += p.speed;
                        if(p.progress > 1) p.progress = 1;
                        let px = originCenter.x + (localCenter.x - originCenter.x) * p.progress;
                        let py = originCenter.y + (localCenter.y - originCenter.y) * p.progress;
                        let offset = Math.sin(p.progress * Math.PI * 4 + p.delay) * 20 * Math.sin(p.progress * Math.PI);
                        py += offset;
                        ctx.beginPath(); ctx.arc(px, py, 2.5, 0, Math.PI*2); ctx.fill();
                    }
                });
                ctx.shadowBlur = 0;

                if (forkProgress > 0.5) drawConstellation(localCenter, localColor, (forkProgress - 0.5) * 2);
                if (forkProgress >= 1.2) { state = 'forked'; if(onStateChange) onStateChange('forked'); }
            } else if (state === 'forked') {
                ctx.strokeStyle = `rgba(${localColor}, 0.25)`;
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(originCenter.x, originCenter.y); ctx.lineTo(localCenter.x, localCenter.y); ctx.stroke();
                drawConstellation(localCenter, localColor, 1);
                
                ctx.fillStyle = `rgb(${localColor})`; ctx.font = 'bold 11px "Inter", sans-serif';
                ctx.fillText('✦ SYNCED', localCenter.x, localCenter.y - 120);
            }

            rafId = requestAnimationFrame(draw);
        }
        draw();
        return () => { canvas.removeEventListener('click', clickHandler); };
    }

    // ==========================================
    // 2. 光纤织链 (Fiber Branching)
    // ==========================================
    function startFiberBranch() {
        let state = 'idle'; 
        let t = 0;
        let forkProgress = 0;

        const clickHandler = () => {
            if(state === 'idle') {
                state = 'forking';
                forkProgress = 0;
                if(onStateChange) onStateChange('forking');
            }
        };
        canvas.addEventListener('click', clickHandler);

        let packets = Array.from({length: 12}, () => ({
            y: Math.random() * 1000, speed: 4 + Math.random() * 3, length: 15 + Math.random() * 30
        }));
        let localPackets = [];

        function draw() {
            t += 1;
            const bg = isDark ? '#0D0D0F' : '#F5EFEA';
            const originColor = isDark ? '240, 74, 138' : '18, 46, 138'; // Pink / Deep Blue
            const localColor = isDark ? '52, 211, 153' : '16, 185, 129'; // Emerald
            
            ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

            let trunkX = W * 0.35, branchY = H * 0.45, localX = W * 0.65;
            
            // Draw Main Trunk
            ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${originColor}, 0.15)`;
            ctx.beginPath(); ctx.moveTo(trunkX, 0); ctx.lineTo(trunkX, H); ctx.stroke();
            
            for(let i=80; i<H; i+=100) {
                ctx.fillStyle = `rgb(${originColor})`;
                ctx.beginPath(); ctx.arc(trunkX, i, 4, 0, Math.PI*2); ctx.fill();
            }

            ctx.shadowBlur = 20; ctx.shadowColor = `rgb(${originColor})`;
            ctx.lineCap = 'round'; ctx.lineWidth = 4;
            
            packets.forEach(p => {
                p.y += p.speed;
                if(p.y > H + 100) p.y = -100;
                let alpha = (state !== 'idle' && p.y > branchY) ? 0.2 : 1;
                ctx.strokeStyle = `rgba(${originColor}, ${alpha})`;
                ctx.beginPath(); ctx.moveTo(trunkX, p.y - p.length); ctx.lineTo(trunkX, p.y); ctx.stroke();

                if (state !== 'idle' && Math.abs(p.y - branchY) < p.speed) {
                    localPackets.push({ progress: 0, y: 0, speed: p.speed * 0.005, trunkSpeed: p.speed, length: p.length });
                }
            });
            ctx.shadowBlur = 0; ctx.lineCap = 'butt';

            ctx.fillStyle = isDark ? '#FFF' : '#333'; ctx.font = '500 11px "Inter", sans-serif';
            ctx.textAlign = 'right'; ctx.globalAlpha = 0.5;
            ctx.fillText('ORIGIN TRUNK', trunkX - 20, branchY); ctx.globalAlpha = 1;

            if (state === 'forking') {
                forkProgress += 0.015;
                if (forkProgress >= 1) { state = 'forked'; if(onStateChange) onStateChange('forked'); }
            }

            if (state !== 'idle') {
                let ease = Math.min(1, forkProgress);
                let cp1x = trunkX + (localX - trunkX) * 0.6, cp1y = branchY;
                let cp2x = trunkX + (localX - trunkX) * 0.4, cp2y = branchY + 120;
                
                ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${localColor}, 0.2)`;
                ctx.beginPath(); ctx.moveTo(trunkX, branchY);
                ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, localX, branchY + 120); ctx.stroke();

                let currentH = (H - (branchY + 120)) * ease, currentUpH = (branchY + 120) * ease; 
                ctx.beginPath(); ctx.moveTo(localX, branchY + 120 - currentUpH); ctx.lineTo(localX, branchY + 120 + currentH); ctx.stroke();

                ctx.fillStyle = `rgb(${localColor})`; ctx.textAlign = 'left'; ctx.globalAlpha = ease;
                ctx.fillText('✦ FORKED BRANCH', localX + 20, branchY + 120); ctx.globalAlpha = 1;

                ctx.shadowBlur = 20; ctx.shadowColor = `rgb(${localColor})`; ctx.lineCap = 'round'; ctx.lineWidth = 4;
                for(let i = localPackets.length - 1; i >= 0; i--) {
                    let lp = localPackets[i];
                    ctx.strokeStyle = `rgb(${localColor})`;
                    if (lp.progress < 1) {
                        lp.progress += lp.speed;
                        let t = lp.progress;
                        let px = Math.pow(1-t,3)*trunkX + 3*Math.pow(1-t,2)*t*cp1x + 3*(1-t)*t*t*cp2x + Math.pow(t,3)*localX;
                        let py = Math.pow(1-t,3)*branchY + 3*Math.pow(1-t,2)*t*cp1y + 3*(1-t)*t*t*cp2y + Math.pow(t,3)*(branchY+120);
                        ctx.beginPath(); ctx.moveTo(px - 4, py - 4); ctx.lineTo(px, py); ctx.stroke();
                    } else {
                        lp.y += lp.trunkSpeed;
                        ctx.beginPath(); ctx.moveTo(localX, branchY + 120 + lp.y - lp.length); ctx.lineTo(localX, branchY + 120 + lp.y); ctx.stroke();
                        if (branchY + 120 + lp.y > H + 100) localPackets.splice(i, 1);
                    }
                }
                ctx.shadowBlur = 0; ctx.lineCap = 'butt';
            }

            rafId = requestAnimationFrame(draw);
        }
        draw();
        return () => { canvas.removeEventListener('click', clickHandler); };
    }
}

;
// Auto-mount for landing page (index.html)
(function() {
    if (typeof document !== 'undefined' && document.getElementById('share-canvas') && !window.__shareVisualMounted) {
        window.__shareVisualMounted = true;
        
        // Read concept from URL or localStorage for landing page preview
        let concept = 1; // Default
        if (typeof URLSearchParams !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.has('concept')) {
                concept = params.get('concept');
            } else if (localStorage.getItem('lv_share_concept')) {
                concept = localStorage.getItem('lv_share_concept');
            }
        }
        
        // Auto-run
        const canvas = document.getElementById('share-canvas');
        
        // Use IntersectionObserver to play/pause like original
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
