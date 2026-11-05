/* Progressive enhancement: content and forms work without any animation dependency. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = document.querySelector('#motion-toggle');
  let paused = reduced.matches, context, lenis, ticker, marquee, threePaused = () => {};
  const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
  function stopMotion() {
    if (context) { context.revert(); context = null; }
    if (marquee) { marquee.kill(); marquee = null; }
    if (lenis) { lenis.destroy(); lenis = null; window.voceraLenis = null; }
    if (ticker && gsap) { gsap.ticker.remove(ticker); ticker = null; }
    document.body.classList.add('motion-paused');
  }
  function startMotion() {
    document.body.classList.remove('motion-paused');
    if (!gsap || !ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);
    if (window.Lenis && matchMedia('(pointer:fine)').matches) {
      lenis = new window.Lenis({duration:1.1, smoothWheel:true, syncTouch:false});
      window.voceraLenis = lenis;
      lenis.on('scroll', ScrollTrigger.update);
      ticker = time => lenis && lenis.raf(time * 1000);
      gsap.ticker.add(ticker);
      if (document.body.classList.contains('nav-open')) lenis.stop();
    }
    context = gsap.context(() => {
      gsap.from('.hero-title span', {yPercent:40,opacity:0,rotate:3,duration:1.2,stagger:.15,ease:'power3.out'});
      gsap.from('.hero-bottom', {opacity:0,y:25,duration:1,delay:.4});
      gsap.to('.scroll-meter', {scaleX:1,ease:'none',scrollTrigger:{trigger:document.body,start:'top top',end:'bottom bottom',scrub:true}});
      gsap.to('.hero-title',{yPercent:20,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
      gsap.to('.scene',{rotation:-12,yPercent:12,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:1}});
      document.querySelectorAll('.studio-copy,.method-heading,.contact-aside').forEach(el => {
        gsap.from(el,{y:40,opacity:0,duration:.9,ease:'power2.out',scrollTrigger:{trigger:el,start:'top 90%',once:true}});
      });
      document.querySelectorAll('.collage-card').forEach((el,i) => {
        gsap.from(el,{y:80+i*20,rotation:i%2 ? 18:-18,scale:.88,scrollTrigger:{trigger:'.voice-collage',start:'top 95%',end:'center 40%',scrub:1}});
      });
      gsap.to('.mini-wave i',{scaleY:.4,stagger:.1,duration:.7,repeat:-1,yoyo:true,ease:'sine.inOut'});
      gsap.to('.art-connect i',{rotation:180,transformOrigin:'40% 50%',duration:14,repeat:-1,ease:'none'});
      gsap.from('.art-grow i',{scaleY:.1,transformOrigin:'bottom',stagger:.1,duration:1.1,scrollTrigger:{trigger:'.phase-grow',start:'top bottom',once:true}});
      const mm=gsap.matchMedia();
      mm.add('(min-width: 1000px) and (min-height: 720px)',()=>{
        const stage=document.querySelector('.method-stage'), track=document.querySelector('.phases');
        stage.classList.add('is-horizontal');
        gsap.to(track,{x:()=>-Math.max(0,track.scrollWidth-stage.clientWidth),ease:'none',scrollTrigger:{trigger:stage,start:'top 100px',end:()=>'+='+Math.max(1,track.scrollWidth-stage.clientWidth),pin:true,scrub:1,anticipatePin:1,invalidateOnRefresh:true}});
        return ()=>stage.classList.remove('is-horizontal');
      });
      document.querySelectorAll('.aud').forEach((el,i)=>{
        gsap.from(el,{y:80,rotation:i?9:-9,opacity:0,scrollTrigger:{trigger:el,start:'top 95%',end:'top 55%',scrub:1}});
      });
      const track = document.querySelector('.ribbon-track');
      if (track) {
        marquee = gsap.to(track,{xPercent:-50,duration:26,repeat:-1,ease:'none'});
        ScrollTrigger.create({trigger:'.ribbon',start:'top bottom',end:'bottom top',onToggle:self=>marquee && (self.isActive ? marquee.play() : marquee.pause())});
      }
      gsap.from('.footer-wordmark',{yPercent:35,opacity:.2,scrollTrigger:{trigger:'.site-footer',start:'top bottom',end:'bottom bottom',scrub:1}});
      return ()=>mm.revert();
    });
    if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
  function sync() {
    if(paused) stopMotion(); else startMotion();
    threePaused(paused);
    const label = paused ? 'Activar movimiento' : 'Pausar movimiento';
    toggle.innerHTML = '<span class="mc-icon" aria-hidden="true">' + (paused ? '▶' : '❚❚') + '</span><span class="mc-label">' + label + '</span>';
    toggle.setAttribute('aria-label', label); toggle.title = label;
    toggle.setAttribute('aria-pressed',String(paused));
  }
  toggle.hidden = false;
  toggle.addEventListener('click',()=>{paused = !paused;sync();});
  reduced.addEventListener('change',e=>{paused=e.matches;sync();});
  sync();
  document.addEventListener('visibilitychange',()=>{
    if(marquee) document.hidden ? marquee.pause() : (!paused && ScrollTrigger.isInViewport(document.querySelector('.ribbon')) && marquee.play());
  });
  // A sculpted sound wave: actual geometry, light, perspective and pointer response.
  // A CSS sculpture is visible until WebGL has successfully rendered.
  // WebGL is decorative: only capable desktops download it (~690 KB min, ~175 KB gzip).
  // Phones, data saver, low-end CPUs and reduced motion keep the CSS sculpture.
  function canUseWebGL() {
    const c = navigator.connection;
    if (reduced.matches) return false;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return false;
    if ((navigator.hardwareConcurrency || 4) < 4) return false;
    return matchMedia('(min-width: 1000px) and (pointer: fine)').matches;
  }
  async function initScene() {
    const host=document.querySelector('#voice-scene');
    if (!host || !canUseWebGL()) return;
    let THREE;
    try { THREE=await import('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js'); }
    catch { return; }
    let renderer;
    try { renderer=new THREE.WebGLRenderer({alpha:true,antialias:devicePixelRatio<2,powerPreference:'low-power'}); }
    catch { return; }
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(35,1,.1,100);
    camera.position.set(0,0,14);
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    renderer.setClearColor(0,0);
    host.append(renderer.domElement);
    const group=new THREE.Group();scene.add(group);
    group.rotation.set(.25,-.45,-.3);
    scene.add(new THREE.AmbientLight(0x859bce,2.4));
    const key=new THREE.DirectionalLight(0xe6efff,5);key.position.set(-4,5,6);scene.add(key);
    const rim=new THREE.PointLight(0x295dff,95);rim.position.set(4,0,4);scene.add(rim);
    const back=new THREE.DirectionalLight(0xffffff,2);back.position.set(2,-4,-2);scene.add(back);
    const blue=new THREE.MeshStandardMaterial({color:0x2856e4,metalness:.65,roughness:.23});
    const silver=new THREE.MeshStandardMaterial({color:0xbac8df,metalness:.8,roughness:.22});
    const bars=[];
    for(let i=0;i<25;i++) {
      const normalized=(i-12)/12;
      const height=.5+3.6*Math.pow(1-Math.abs(normalized),.6);
      const geometry=new THREE.BoxGeometry(.19,height,.6,1,1,1);
      const mesh=new THREE.Mesh(geometry,i===11||i===12 ? silver:blue);
      mesh.position.set(normalized*3.5,Math.sin(i*.32)*.4,Math.cos(i*.25)*.6);
      mesh.rotation.z=-.12;group.add(mesh);bars.push(mesh);
    }
    let visible=true,frame=0,time=0,last=0,px=0,py=0,alive=true;
    function size(){const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();render();}
    function render(){renderer.render(scene,camera);}
    function animate(now){frame=0;if(!alive||!visible||document.hidden||paused)return;time+=Math.min((now-last)/1000,.05);last=now;group.rotation.y=-.45+Math.sin(time*.3)*.2+px*.22;group.rotation.x=.25+py*.12;bars.forEach((bar,i)=>{bar.scale.y=1+Math.sin(time*1.5+i*.35)*.13;bar.position.z=Math.cos(i*.25+time*.35)*.65;});render();frame=requestAnimationFrame(animate);}
    function resume(){if(!frame&&visible&&!document.hidden&&!paused&&alive){last=performance.now();frame=requestAnimationFrame(animate);}}
    function suspend(){cancelAnimationFrame(frame);frame=0;}
    threePaused=value=>{if(value){suspend();render();}else resume();};
    new ResizeObserver(size).observe(host);
    new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)resume();else suspend();}).observe(host);
    document.addEventListener('visibilitychange',()=>document.hidden?suspend():resume());
    document.querySelector('.hero').addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'||paused)return;const r=host.getBoundingClientRect();px=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));py=Math.max(-1,Math.min(1,(e.clientY-r.top)/r.height*2-1));},{passive:true});
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();alive=false;suspend();host.classList.remove('ready');});
    size();host.classList.add('ready');resume();
    window.addEventListener('pagehide',suspend);
    window.addEventListener('pageshow',resume);
  }
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
  if (document.readyState === 'complete') idle(initScene, {timeout: 2000});
  else window.addEventListener('load', () => idle(initScene, {timeout: 2000}), {once: true});

  // Fixed controls step aside while the contact form is on screen,
  // so they never cover fields or the submit button (mainly on phones).
  const contact = document.querySelector('#contacto .voice-form')?.closest('section');
  if (contact && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => document.body.classList.toggle('form-in-view', e.isIntersecting),
      {rootMargin: '0px 0px -35% 0px'}).observe(contact);
  }
})();
