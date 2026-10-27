import {$, $$, restart, ctl} from './util.js';

export function openHow(){
  const s = $('#how');
  $('#sheetLeave').hidden = !ctl.room();
  s.hidden = false;
  restart($('.sheet-in', s), 'pop');
  $('.sheet-x', s).focus();
}
export function closeSheets(){ $$('.sheet').forEach(s => s.hidden = true); }

export function initSheets(){
  $$('.sheet-x').forEach(b => b.addEventListener('click', closeSheets));
  $$('.sheet').forEach(s => s.addEventListener('click', e => { if(e.target === s) closeSheets(); }));
  addEventListener('keydown', e => { if(e.key === 'Escape') closeSheets(); });
  $('#sheetLeave').addEventListener('click', () => { closeSheets(); if(confirm('Leave this room?')) ctl.leave(); });
}
