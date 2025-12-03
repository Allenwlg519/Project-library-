// 月经记录、日历渲染与提醒脚本（支持日历视图、预测与动态贴士）
(function(){
  const STORAGE_KEY = 'menstrual_records_v1';

  // DOM
  const periodForm = document.getElementById('periodForm');
  const periodDate = document.getElementById('periodDate');
  const avgCycleInput = document.getElementById('avgCycleInput');
  const periodLengthInput = document.getElementById('periodLengthInput');
  const periodList = document.getElementById('periodList');
  const countEl = document.getElementById('count');
  const avgCycleEl = document.getElementById('avgCycle');
  const nextPeriodEl = document.getElementById('nextPeriod');
  const notifyBtn = document.getElementById('notifyBtn');
  const clearBtn = document.getElementById('clearBtn');
  const tipContent = document.getElementById('tipContent');
  const calendarGrid = document.getElementById('calendar');
  const monthLabel = document.getElementById('monthLabel');
  const prevMonthBtn = document.getElementById('prevMonth');
  const nextMonthBtn = document.getElementById('nextMonth');

  let records = loadRecords();
  let remindersEnabled = false;
  let reminderTimer = null;
  // 临时的预测天集合（只在内存中，用于日历高亮展示）
  let predictedDays = {};

  // 当前显示的年月
  let viewYear = (new Date()).getFullYear();
  let viewMonth = (new Date()).getMonth();

  function loadRecords(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {days:{}};
      const parsed = JSON.parse(raw);
      // 向后兼容：如果旧格式是 periods 数组，则转换为按天记录
      if(parsed.periods && Array.isArray(parsed.periods)){
        const days = {};
        parsed.periods.forEach(p=>{
          const start = new Date(p.start);
          const len = p.length || p.length===0 ? p.length : (p.length===0?0: (p.length||Number(document.getElementById('periodLengthInput').value||5)));
          for(let i=0;i<(len||1);i++){
            const d = new Date(start.getTime() + i*24*60*60*1000);
            days[fmt(d)] = {period:true, pain:p.pain, flow:p.flow, mood:p.mood};
          }
        });
        return {days};
      }
      return parsed;
    }catch(e){ console.error(e); return {days:{}}; }
  }

  function saveRecords(){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }

  // day-level setters
  function setDayData(isoDate, data){
    records.days = records.days || {};
    records.days[isoDate] = Object.assign({}, records.days[isoDate] || {}, data);
    // ensure period boolean if present
    if(records.days[isoDate].period===undefined) records.days[isoDate].period = !!records.days[isoDate].period;
    saveRecords(); renderAll();
  }

  function removeDay(isoDate){
    if(records.days && records.days[isoDate]){
      delete records.days[isoDate]; saveRecords(); renderAll();
    }
  }

  // 新的按天记录：用 setDayData 替代 addPeriod
  function addPeriod(dateStr){
    // 兼容旧调用：将其映射为把该日标记为 period
    setDayData(dateStr, {period:true});
  }

  function removePeriod(dateStr){
    // 兼容：移除以 start 为 key 的记录（旧格式），以及按天条目
    removeDay(dateStr);
    if(records.periods) records.periods = records.periods.filter(x=>x.start!==dateStr);
    saveRecords(); renderAll();
  }

  function clearAll(){
    if(!confirm('确定要清空所有记录吗？')) return;
    records = {days:{}}; saveRecords(); renderAll();
  }

  // 根据按天记录推算周期开始日并计算平均周期
  function getStartsFromDays(){
    const days = Object.keys(records.days||{}).sort((a,b)=>new Date(b)-new Date(a));
    // 我们需要按日期升序来检测连续块
    const asc = Object.keys(records.days||{}).sort((a,b)=>new Date(a)-new Date(b));
    const ranges = [];
    let curStart = null, curEnd = null;
    asc.forEach(d=>{
      const rec = records.days[d];
      if(rec && rec.period){
        if(!curStart){ curStart = d; curEnd = d; }
        else {
          const prev = new Date(curEnd); const cur = new Date(d);
          const diff = (cur - prev)/(1000*60*60*24);
          if(diff===1){ curEnd = d; } else { ranges.push({start:curStart,end:curEnd}); curStart = d; curEnd = d; }
        }
      }
    });
    if(curStart) ranges.push({start:curStart,end:curEnd});
    // starts descending
    const startsDesc = ranges.map(r=>r.start).sort((a,b)=>new Date(b)-new Date(a));
    return startsDesc;
  }

  function computeAverageCycle(){
    const starts = getStartsFromDays();
    if(starts.length<2) return null;
    let sum=0, count=0;
    for(let i=0;i<starts.length-1;i++){
      const d1 = new Date(starts[i]);
      const d2 = new Date(starts[i+1]);
      const diff = (d1 - d2) / (1000*60*60*24);
      if(diff>0){ sum+=diff; count++; }
    }
    return count? Math.round(sum/count): null;
  }

  function predictNextStarts(count=3){
    const starts = [];
    const startsDesc = getStartsFromDays();
    if(startsDesc.length===0) return starts;
    const avg = computeAverageCycle() || Number(avgCycleInput.value) || 28;
    let last = new Date(startsDesc[0]);
    for(let i=0;i<count;i++){
      last = new Date(last.getTime() + avg*24*60*60*1000);
      starts.push(last);
    }
    return starts;
  }

  function getPeriodRanges(aheadCycles=3){
    // 从按天记录生成已记录范围
    const ranges = [];
    const asc = Object.keys(records.days||{}).sort((a,b)=>new Date(a)-new Date(b));
    let cur = null;
    asc.forEach(d=>{
      const rec = records.days[d];
      if(rec && rec.period){
        if(!cur) cur = {start:new Date(d), end:new Date(d)};
        else { const prev = new Date(cur.end); const curd = new Date(d); if((curd - prev)/(1000*60*60*24)===1){ cur.end = curd; } else { ranges.push(cur); cur = {start:new Date(d), end:new Date(d)}; } }
      } else { if(cur){ ranges.push(cur); cur=null; } }
    });
    if(cur) ranges.push(cur);
    // 将已记录标记为 source 'record'
    const out = ranges.map(r=>({start:r.start,end:r.end,source:'record'}));
    // 预测基于 starts
    const preds = predictNextStarts(aheadCycles);
    const defaultLen = Number(periodLengthInput.value) || 5;
    preds.forEach(s=>{ const e = new Date(s.getTime() + (defaultLen-1)*24*60*60*1000); out.push({start:s,end:e,source:'predicted'}); });
    return out;
  }

  // 标记某个开始日的预测月经天（仅视觉提示，不立即保存为真实记录）
  function markPredictedPeriodForStart(startIso){
    predictedDays = {}; // 清空之前的预测
    const defaultLen = Number(periodLengthInput.value) || 5;
    const start = new Date(startIso);
    for(let i=0;i<defaultLen;i++){
      const d = new Date(start.getTime() + i*24*60*60*1000);
      predictedDays[fmt(d)] = true;
    }
    // 重新渲染日历以显示预测样式
    renderCalendar(viewYear, viewMonth);
  }

  function clearPredictedDays(){ predictedDays = {}; renderCalendar(viewYear, viewMonth); }

  // 计算易孕期与排卵日范围（基于预测开始日与平均周期）
  function getFertileOvulationRanges(aheadCycles=3){
    const ranges = [];
    const starts = getStartsFromDays();
    if(starts.length===0) return ranges;
    const avg = computeAverageCycle() || Number(avgCycleInput.value) || 28;
    let last = new Date(starts[0]);
    for(let i=0;i<aheadCycles;i++){
      const nextStart = new Date(last.getTime() + avg*24*60*60*1000);
      // 估算排卵日：距下一次月经开始前约14天
      const ovulation = new Date(nextStart.getTime() - 14*24*60*60*1000);
      const fertileStart = new Date(ovulation.getTime() - 5*24*60*60*1000);
      const fertileEnd = new Date(ovulation.getTime());
      ranges.push({start:fertileStart, end:fertileEnd, source:'fertile'});
      ranges.push({start:ovulation, end:ovulation, source:'ovulation'});
      last = nextStart;
    }
    return ranges;
  }

  // 日期工具
  // 格式化为本地 ISO 日期 yyyy-mm-dd（不含时区偏移）
  function fmt(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function isSameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

  // Calendar rendering
  function renderCalendar(year, month){
    calendarGrid.innerHTML = '';
    const first = new Date(year, month, 1);
    const dow = first.getDay(); // 0-6 (Sun-Sat)
    const daysInMonth = new Date(year, month+1,0).getDate();
    // render weekday headers
    const weekdays = ['日','一','二','三','四','五','六'];
    weekdays.forEach(w=>{ const el=document.createElement('div'); el.className='day header'; el.textContent=w; calendarGrid.appendChild(el); });

    // pad blanks for first week
    for(let i=0;i<dow;i++){ const el=document.createElement('div'); el.className='day empty'; calendarGrid.appendChild(el); }

  const ranges = getPeriodRanges(6); // 多画些预测
  const phaseRanges = getFertileOvulationRanges(6);
    const today = new Date();

    for(let d=1; d<=daysInMonth; d++){
      const date = new Date(year, month, d);
      const cell = document.createElement('div'); cell.className='day';
      const num = document.createElement('div'); num.className='date-num'; num.textContent = d; cell.appendChild(num);
      // 判断标签
      // 先标记易孕/排卵，再标记预测，最后标记已记录（使已记录样式优先）
      phaseRanges.forEach(r=>{
        if(date.getTime() >= startOfDay(r.start).getTime() && date.getTime() <= startOfDay(r.end).getTime()){
          cell.classList.add(r.source==='fertile' ? 'fertile' : 'ovulation');
        }
      });
      ranges.forEach(r=>{
        if(date.getTime() >= startOfDay(r.start).getTime() && date.getTime() <= startOfDay(r.end).getTime()){
          cell.classList.add(r.source==='record' ? 'period' : 'predicted');
        }
      });
      if(isSameDay(date, today)) cell.classList.add('today');

      // small info
      const small = document.createElement('div'); small.className='small';
      const dayRec = records.days && records.days[fmt(date)];
      if(dayRec && dayRec.period){ small.textContent = '已记录月经日'; cell.classList.add('period'); }
      else {
        // 优先显示排卵/易孕信息
        const fmtDate = fmt(date);
        const ph = phaseRanges.find(r=> fmt(r.start) <= fmtDate && fmtDate <= fmt(r.end));
        if(ph){ small.textContent = ph.source==='ovulation' ? '排卵日' : '易孕期'; cell.classList.add(ph.source==='ovulation'?'ovulation':'fertile'); }
        else {
          const predStarts = predictNextStarts(6).map(d=>fmt(d));
          if(predStarts.includes(fmtDate)) { small.textContent = '预测开始日'; cell.classList.add('predicted'); }
          // 如果当前日期在本次用户选择的预测日集合中，显示不同的提示样式
          if(predictedDays[fmtDate]){ small.textContent = '本次预计月经日'; cell.classList.add('predicted-period'); }
        }
      }
      cell.appendChild(small);

      // click handler: 打开日编辑器
      cell.addEventListener('click', ()=>{ openDayEditor(date); });

      calendarGrid.appendChild(cell);
    }
    monthLabel.textContent = `${year} 年 ${month+1} 月`;
  }

  // Day editor functions
  const editor = document.getElementById('dayEditor');
  const editorDateLabel = document.getElementById('editorDateLabel');
  const editorToggle = document.getElementById('editorPeriodToggle');
  const editorPain = document.getElementById('editorPain');
  const editorPainVal = document.getElementById('editorPainVal');
  const editorFlow = document.getElementById('editorFlow');
  const editorNote = document.getElementById('editorNote');
  const editorSave = document.getElementById('editorSave');
  const editorDelete = document.getElementById('editorDelete');
  const editorClose = document.getElementById('editorClose');
  let editorCurrentIso = null;

  function openDayEditor(date){
    const iso = fmt(date);
    editorCurrentIso = iso;
    editorDateLabel.textContent = iso;
    const rec = records.days && records.days[iso];
    editorToggle.checked = !!(rec && rec.period);
    editorPain.value = rec && rec.pain!==undefined ? rec.pain : 3; editorPainVal.textContent = editorPain.value;
    editorFlow.value = rec && rec.flow ? rec.flow : 'medium';
    editorNote.value = rec && rec.mood ? rec.mood : '';
    editor.style.display = 'block'; editor.setAttribute('aria-hidden','false');
    // render tip for this date
    renderDailyTip(date);
    // 如果这是被标记为月经开始日，自动展示该周期的预测天颜色提示
    // 我们把“标记为月经开始日”的行为放在保存时触发；如果当前选中日已有 period 且是周期的开始日，则展示预测
    if(rec && rec.period){
      // 判断是否为周期开始：前一天不是 period
      const prev = new Date(date.getTime() - 24*60*60*1000);
      const prevRec = records.days && records.days[fmt(prev)];
      if(!prevRec || !prevRec.period){
        markPredictedPeriodForStart(iso);
      }
    }
  }

  editorPain.addEventListener('input', ()=>{ editorPainVal.textContent = editorPain.value; });
  editorClose.addEventListener('click', ()=>{ editor.style.display='none'; editor.setAttribute('aria-hidden','true'); });
  editorDelete.addEventListener('click', ()=>{ if(!editorCurrentIso) return; if(confirm(`删除 ${editorCurrentIso} 的记录？`)){ removeDay(editorCurrentIso); clearPredictedDays(); editor.style.display='none'; } });
  editorSave.addEventListener('click', ()=>{
    if(!editorCurrentIso) return;
    const rec = {period: !!editorToggle.checked, pain: Number(editorPain.value), flow: editorFlow.value, mood: editorNote.value};
    // 如果取消 period 并且其它字段为空，则删除该日记录以减小存储
    if(!rec.period && (!rec.pain && !rec.flow && !rec.mood)){
      removeDay(editorCurrentIso);
    } else {
      setDayData(editorCurrentIso, rec);
    }
    // 如果这是被标记为月经开始日（即本日为 period 且前一天不是 period），展示该周期的预测天
    if(rec.period){
      const parts = editorCurrentIso.split('-');
      const d = new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
      const prev = new Date(d.getTime() - 24*60*60*1000);
      const prevRec = records.days && records.days[fmt(prev)];
      if(!prevRec || !prevRec.period){ markPredictedPeriodForStart(editorCurrentIso); }
    } else {
      // 如果用户取消了 period 标记，清除预测高亮（避免误导）
      clearPredictedDays();
    }

    editor.style.display='none'; editor.setAttribute('aria-hidden','true');
  });

  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  // render list, stats and tips
  function renderList(){
    periodList.innerHTML='';
    // 列出按日记录的月经开始日（从连续块中取得 start）
    const ranges = getPeriodRanges(0).filter(r=>r.source==='record').sort((a,b)=>new Date(b.start)-new Date(a.start));
    ranges.forEach(rng=>{
      const startIso = fmt(rng.start);
      const dayRec = records.days[startIso] || {};
      const li = document.createElement('li');
      const dateStr = new Date(startIso).toLocaleDateString();
      // 平均疼痛（若每日有数据，可计算期内平均），这里简化为起始日的记录
      li.innerHTML = `<div><strong>${dateStr}</strong> · 持续 ${Math.floor((rng.end - rng.start)/(1000*60*60*24))+1} 天 ${dayRec.flow?`· 出血：${dayRec.flow}`:''} ${dayRec.pain!==undefined?`· 疼痛：${dayRec.pain}`:''}</div>`;
      const edit = document.createElement('button'); edit.textContent='编辑'; edit.style.background='#fff3f7'; edit.style.color='#333'; edit.onclick=()=>{ openEditDialogForDate(startIso); };
      const rm = document.createElement('button'); rm.textContent='删除'; rm.style.background='#eee'; rm.style.color='#333'; rm.onclick=()=>{ if(confirm('删除这次记录（删除该周期内所有日记录）？')){ // 删除区间内每日
        const cur = new Date(rng.start); while(cur<=rng.end){ removeDay(fmt(cur)); cur.setDate(cur.getDate()+1); } } };
      li.appendChild(edit); li.appendChild(rm); periodList.appendChild(li);
    });
  }

  function openEditDialogForDate(isoDate){
    // 打开 day editor 并填充
    const [y,m,d] = isoDate.split('-');
    const date = new Date(Number(y), Number(m)-1, Number(d));
    openDayEditor(date);
  }

  function openEditDialog(record){
    // 简易编辑：使用 prompt 弹窗编辑备注与疼痛评分
    const newPain = prompt('疼痛评分（0-10）', record.pain===undefined?'3':String(record.pain));
    if(newPain===null) return;
    record.pain = Number(newPain);
    const newFlow = prompt('出血量 (light/medium/heavy)', record.flow||'medium');
    if(newFlow!==null) record.flow = newFlow;
    const newMood = prompt('心情/备注', record.mood||''); if(newMood!==null) record.mood = newMood;
    saveRecords(); renderAll();
  }

  function renderStats(){
    const starts = getStartsFromDays();
    countEl.textContent = starts.length;
    const avg = computeAverageCycle() || '--'; avgCycleEl.textContent = avg;
    const next = predictNextStarts(1)[0]; nextPeriodEl.textContent = next ? next.toLocaleDateString() : '--';
  }

  // 每日提示：根据某个日期返回该日对应的生理建议（第几天 -> 对应提示）
  function dailyTipFor(dayIndex){
    // dayIndex 从 1 开始，表示月经期第几天；若为 null 则为非月经日常建议
    const dayTips = {
      1: '第一天：适当休息，准备热敷与温暖；若出血量大，观察并视情况就医。',
      2: '第二天：补充水分与铁质（红肉、绿叶蔬菜）；可用暖水袋缓解腹痛。',
      3: '第三天：轻柔运动有助舒缓肌肉痉挛；避免剧烈运动。',
      4: '第四天：继续保持营养与睡眠，记录出血量与疼痛变化。',
      5: '第五天：开始注意出血量减少趋势，若持续重度出血或异常痛感请就医。'
    };
    const edu = '<strong>科普：</strong>月经是激素周期的表现，周期可受压力、睡眠与药物影响。若长期不规则，请咨询医生。';
    if(dayIndex && dayTips[dayIndex]) return `${dayTips[dayIndex]}<br>${edu}`;
    return `非月经期：保持日常健康作息，关注周期变化以便长期观察。<br>${edu}`;
  }

  function renderDailyTip(date){
    // 判断选中日期是否属于某次月经范围，若是则返回第几天并显示对应提示
    const len = Number(periodLengthInput.value) || 5;
    const ranges = getPeriodRanges(6);
    const selected = startOfDay(date);
    const r = ranges.find(rg => selected.getTime() >= startOfDay(rg.start).getTime() && selected.getTime() <= startOfDay(rg.end).getTime());
    // 如果命中月经范围
    if(r){
      const dayIndex = Math.floor((selected.getTime() - startOfDay(r.start).getTime())/(1000*60*60*24)) + 1;
      // 若选中日有每日记录（如疼痛/出血/备注），展示在提示中
      const rec = records.days[fmt(selected)];
      let extra = '';
      if(rec){ extra += rec.pain!==undefined?`<div>疼痛：${rec.pain}</div>` : ''; extra += rec.flow?`<div>出血：${rec.flow}</div>` : ''; extra += rec.mood?`<div>备注：${rec.mood}</div>` : ''; }
      tipContent.innerHTML = `<p>日期：${fmt(date)} — 月经期第 ${dayIndex} 天</p><p>${dailyTipFor(dayIndex)}</p>${extra}`;
      return;
    } else {
      // 再检测排卵/易孕期
      const phaseRanges = getFertileOvulationRanges(6);
      const ph = phaseRanges.find(rg => selected.getTime() >= startOfDay(rg.start).getTime() && selected.getTime() <= startOfDay(rg.end).getTime());
      if(ph){
        if(ph.source==='ovulation'){
          tipContent.innerHTML = `<p>日期：${fmt(date)} — 排卵日</p><p>排卵期间受孕概率较高。如在备孕/避孕期间请注意相应措施；排卵通常伴随白带增多、质地透明。</p><p><strong>科普：</strong>排卵一般发生在下一次月经开始前约 14 天。</p>`;
        } else {
          tipContent.innerHTML = `<p>日期：${fmt(date)} — 易孕期</p><p>这是易孕窗口（通常排卵日前 5 天至排卵日），受孕概率较高。若不希望怀孕请加强避孕措施；若在备孕，可在此期间做好生活与营养准备。</p><p><strong>科普：</strong>精子在生殖道内可存活数天，因此排卵日前的性交也可能导致妊娠。</p>`;
        }
        return;
      }
      // 非月经/非排卵期，展示当天的记录（若有）或通用建议
      const rec2 = records.days[fmt(selected)];
      let extra2 = '';
      if(rec2){ extra2 += rec2.pain!==undefined?`<div>疼痛：${rec2.pain}</div>` : ''; extra2 += rec2.flow?`<div>出血：${rec2.flow}</div>` : ''; extra2 += rec2.mood?`<div>备注：${rec2.mood}</div>` : ''; }
      tipContent.innerHTML = `<p>日期：${fmt(date)} — 非月经期</p><p>${dailyTipFor(null)}</p>${extra2}`;
    }
  }

  function renderTips(){ renderDailyTip(new Date()); }

  function renderAll(){ renderList(); renderStats(); renderTips(); renderCalendar(viewYear, viewMonth); }

  // Charts: cycle length & pain trend
  let cycleChart = null, painChart = null;
  function buildCharts(){
    const ctx1 = document.getElementById('cycleChart').getContext('2d');
    const ctx2 = document.getElementById('painChart').getContext('2d');
    // 计算周期长度（基于 starts）
    const starts = getStartsFromDays().reverse(); // 升序
    const cycleData = [];
    for(let i=1;i<starts.length;i++){
      const d1 = new Date(starts[i]); const d0 = new Date(starts[i-1]);
      const diff = (d1 - d0)/(1000*60*60*24);
      cycleData.push({x:starts[i], y: diff});
    }
    // 疼痛：使用每个周期起始日的 pain，如果期内有每日 pain，可改为平均
    const painData = starts.map(s=>{ const rec = records.days[s]; return {x:s, y: rec && rec.pain!==undefined ? rec.pain : 0}; });
    if(window.Chart){
      if(cycleChart) cycleChart.destroy();
      if(painChart) painChart.destroy();
      cycleChart = new Chart(ctx1, {type:'line', data:{datasets:[{label:'周期长度(天)', data:cycleData, borderColor:'#ff6fa3', backgroundColor:'rgba(255,111,163,0.08)', fill:true}]}, options:{scales:{x:{type:'time', time:{parser:'yyyy-MM-dd',unit:'month',tooltipFormat:'yyyy-MM-dd'}}}}});
      painChart = new Chart(ctx2, {type:'bar', data:{datasets:[{label:'疼痛评分', data:painData, backgroundColor:'#ffb0cc'}]}, options:{scales:{x:{type:'time', time:{parser:'yyyy-MM-dd',unit:'month',tooltipFormat:'yyyy-MM-dd'}}}}});
    }
  }

  // 在渲染完成后构建图表
  const origRenderAll = renderAll;
  renderAll = function(){ origRenderAll(); buildCharts(); };

  // 通知与提醒（保留原有演示逻辑）
  async function enableNotifications(){
    if(!('Notification' in window)){ alert('您的浏览器不支持通知'); return; }
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ alert('未授权通知权限'); return; }
    remindersEnabled = true; notifyBtn.textContent = '提醒已开启'; scheduleChecks();
  }

  function scheduleChecks(){ if(reminderTimer) clearInterval(reminderTimer); reminderTimer = setInterval(checkAndNotify, 60*1000); checkAndNotify(); }

  function checkAndNotify(){
    if(!remindersEnabled) return; const now = new Date(); const next = predictNextStarts(1)[0]; if(!next) return;
    const periodLen = Number(periodLengthInput.value) || 5;
    const daysUntil = Math.ceil((startOfDay(next) - startOfDay(now))/(1000*60*60*24));
    if(daysUntil<=2 && daysUntil>=0) sendNotification('来经提醒', `距离预计来经还有 ${daysUntil} 天`);
    // 若今天在预计持续内
    const ranges = getPeriodRanges(6);
    const today = startOfDay(now);
    const inRange = ranges.find(r=> today >= startOfDay(r.start) && today <= startOfDay(r.end));
    if(inRange) sendNotification('月经开始提醒', '今天处于月经期，查看温馨贴士和健康建议。');
  }

  function sendNotification(title, body){ try{ const n = new Notification(title, {body}); n.onclick = ()=> window.focus(); }catch(e){ console.error('通知失败', e); } }

  // 事件绑定
  periodForm.addEventListener('submit', e=>{ e.preventDefault(); alert('请直接在日历上点击某日来记录或编辑该日的详细信息。'); });
  clearBtn.addEventListener('click', clearAll);
  notifyBtn.addEventListener('click', enableNotifications);
  prevMonthBtn.addEventListener('click', ()=>{ viewMonth--; if(viewMonth<0){ viewMonth=11; viewYear--; } renderCalendar(viewYear, viewMonth); });
  nextMonthBtn.addEventListener('click', ()=>{ viewMonth++; if(viewMonth>11){ viewMonth=0; viewYear++; } renderCalendar(viewYear, viewMonth); });

  // 初始化
  renderAll();
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && remindersEnabled) scheduleChecks(); if(document.visibilityState!=='visible' && reminderTimer){ clearInterval(reminderTimer); reminderTimer=null; } });

  // 暴露调试接口
  window._menstrual = {records, addPeriod, removePeriod, predictNextStarts, computeAverageCycle};

})();
