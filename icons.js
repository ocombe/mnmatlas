/* Hand-drawn-style pictograms. Only these fixed SVG paths enter the DOM. */
const tradePaths = {
  'Stone Cutting': 'M4 4h11v6H4z M15 5h3l3 3v2h-6 M9 10v12h4V10',
  'Tinkering': 'M12.00 4.00 L12.87 2.04 L15.42 2.60 L15.38 4.75 L17.66 6.34 L17.66 6.34 L19.66 5.57 L21.06 7.77 L19.52 9.26 L20.00 12.00 L20.00 12.00 L21.96 12.87 L21.40 15.42 L19.25 15.38 L17.66 17.66 L17.66 17.66 L18.43 19.66 L16.23 21.06 L14.74 19.52 L12.00 20.00 L12.00 20.00 L11.13 21.96 L8.58 21.40 L8.62 19.25 L6.34 17.66 L6.34 17.66 L4.34 18.43 L2.94 16.23 L4.48 14.74 L4.00 12.00 L4.00 12.00 L2.04 11.13 L2.60 8.58 L4.75 8.62 L6.34 6.34 L6.34 6.34 L5.57 4.34 L7.77 2.94 L9.26 4.48 L12.00 4.00Z M15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 1 0 7 0',
  'Survival': 'M2 20 12 4l10 16z M8 20l4-8 4 8 M12 4V1',
  'Wilderness': 'M3 20l7-14 5 9 3-5 4 10z M7 12l3 2 2-3 M18 2v4m-2-2h4',
  'Riding': 'M6 21v-5l-3-3 3-8 6-2 1 4 5 3-2 5-5-1 3 7 M6 5 5 2l5 2 M10 8h1',
  'Lumberjacking': 'M12 2 5 10h3l-5 7h7v5h4v-5h7l-5-7h3z',
  'Mining': 'M5 22 15 4 M3 8C9 1 17 2 22 9 M13 4l5 4',
  'Herbalism': 'M12 14v8 M12 19c-5 0-7-3-7-4 4 0 7 1 7 4 M12 21c5 0 7-3 7-4-4 0-7 1-7 4 M10 5C7-1 17-1 14 5c6-3 8 5 2 5 4 5-3 9-4 3-1 6-8 2-4-3-6 0-4-8 2-5z M14 8a2 2 0 1 0-4 0 2 2 0 1 0 4 0',
  'First Aid': 'M8 3h8v5h5v8h-5v5H8v-5H3V8h5z',
  'Leatherworking': 'M7 3c3 3 7 3 10 0l4 5-4 3 2 9c-5-2-9-2-14 0l2-9-4-3z M11 9v2m0 3v2',
  'Skinning / Tanning': 'M5 21 11 15 M8 18l3 3 M11 15C18 12 22 7 20 2L9 13z',
  'Wagoneering': 'M3 7h14v9H3z M1 4h2v3m14 5h4l2 5 M7 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M18 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M7 7v6m5-6v6',
  'Animal Taming': 'M7 13c-6 7 1 9 5 6 4 3 11 1 5-6l-5-3z M4 5c-3 0-3 5 0 5s3-5 0-5 M9 2c-3 0-3 5 0 5s3-5 0-5 M15 2c-3 0-3 5 0 5s3-5 0-5 M20 5c-3 0-3 5 0 5s3-5 0-5',
  'Cooking': 'M4 10h16l-2 11H6z M2 12h2m16 0h2 M3 7h18 M10 3h4 M8 1v2m8-2v2',
  'Jewelcrafting': 'M3 8l4-5h10l4 5-9 13z M3 8h18 M7 3l2 5 3 13 3-13 2-5',
  'Brewing / Fermenting': 'M4 7h13v 14H4z M17 9h3q3 0 2 4l-1 4h-4 M4 7C0 3 5 1 7 3c1-3 6-3 7 0 4-2 6 2 3 4 M8 11v7m5-7v7',
  'Spycraft': 'M17 10a7 7 0 1 0-14 0 7 7 0 1 0 14 0 M15 15l7 7 M6 10a4 4 0 0 1 4-4',
  'Tailoring': 'M6 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6 M18 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6 M8 16 19 3 M16 16 5 3',
  'Blacksmithing / Smelting': 'M2 9h20l-4 5h-5v4h5v3H5v-3h4v-4H5z M5 3h9v3H5z M10 1v8',
  'Pottery': 'M2 8h20c-1 7-4 10-10 10S3 15 2 8z M2 8q10 4 20 0 M8 18v3h8v-3',
  'Fletching': 'M3 21 21 3 M14 3h7v7 M3 14l6 1 1 6 M6 11l6 1 1 6',
  'Archaeology': 'M9 2h6v3a3 3 0 0 1-6 0z M12 8v7 M7 14h10v4c0 3-5 5-5 5s-5-2-5-5z',
  'Alchemy': 'M9 2h6 M10 2v7L3 19q-1 3 3 3h12q4 0 3-3L14 9V2 M7 15h10 M10 18h1m3-6h1',
  'Spinning': 'M10 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16 M10 5v16 M2 13h16 M4 7l12 12M4 19 16 7 M20 3v17m-2-15 2-3 2 3',
  'Spellcrafting': 'M2 5q5-3 10 0 5-3 10 0v15q-5-3-10 0-5-3-10 0z M12 5v15 M17 7l1 3 3 1-3 1-1 3-1-3-2-1 2-1z M5 9h4m-4 4h4',
  'Astrology': 'M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z M19 2h3m-1-1v3',
  'Fishing': 'M1 12c4-7 12-7 16 0-4 7-12 7-16 0z M17 12l6-5v10z M6 11v.01 M10 8.5q1.5 3.5 0 7',
  'Farming': 'M12 22V3 M12 8C5 8 4 4 4 3c5 0 8 2 8 5 M12 13c-7 0-8-4-8-5 5 0 8 2 8 5 M12 8c7 0 8-4 8-5-5 0-8 2-8 5 M12 17c7 0 8-4 8-5-5 0-8 2-8 5',
  '(Dis)Enchanting': 'M3 21 16 8 M13 5l6 6 M18 1l1 3 3 1-3 1-1 3-1-3-3-1 3-1z M5 3v4M3 5h4 M18 16v6m-3-3h6',
  'Navigation': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M16 7l-2 7-7 3 3-7z M12 2v2m0 16v2M2 12h2m16 0h2',
  'Carpentry / Woodworking': 'M2 16l13-9 6 1 1 4-5 4-1-2-3 4-1-2-3 4-1-2-3 4z M17 10l2 1-2 2',
  'Cartography': 'M2 5l6-3 8 3 6-3v17l-6 3-8-3-6 3z M8 2v17m8-14v17 M11 10l2 3m-2 0 2-3'
};
const categoryPaths = {
  'Notable NPC': 'M16 7a4 4 0 1 0-8 0 4 4 0 1 0 8 0 M4 22v-3a8 8 0 0 1 16 0v3 M4 22h16',
  'Bank': 'M8 7 6 2h12l-2 5 M8 7h8c1 4 6 6 6 10 0 7-20 7-20 0 0-4 5-6 6-10z M8 8h8 M15 12h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9 M12 11v10',
  'Inn': 'M2 4v18 M2 17h20v5 M2 10h7v7 M9 8h9q4 0 4 4v5 M4 12h3v3H4z',
  'Quest': 'M8 3h11a2 2 0 0 1 0 4h-2 M8 3a2 2 0 0 0-2 2v12 M17 7v12a2 2 0 0 1-2 2H5a2 2 0 0 1 0-4h9 M11.5 8.5v4.5 M11.5 16v.01',
  'Mob camp': 'M4 4l11 11 M12.5 17.5l5-5 M15 15l4.5 4.5 M20 4 9 15 M6.5 12.5l5 5 M9 15l-4.5 4.5',
  'Named mob': 'M12 3c-5 0-8 3.2-8 7.5 0 2.5 1.2 4 3 5V19h10v-3.5c1.8-1 3-2.5 3-5C20 6.2 17 3 12 3z M10.5 10.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 1 0 3 0 M16.5 10.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 1 0 3 0 M12 13l-1 2h2z M10 19v2.5h4V19 M12 19v2.5',
  'Vendor': 'M3 9l2-5h14l2 5 M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0 M9 4 8 9 M15 4l1 5 M5 11v10 M19 11v10 M5 15h14 M3 21h18'
};
// Resource nodes reuse the matching trade pictograms in their own colours.
Object.assign(categoryPaths,{'Herbs':tradePaths['Herbalism'],'Wood':tradePaths['Lumberjacking'],'Ore':tradePaths['Mining']});
// A small palette personal markers may use instead of their category colour.
const pinColours={Red:'#a04438',Amber:'#b5861f',Green:'#4f7a3a',Teal:'#385f60',Blue:'#2f6f9a',Purple:'#6a4a7a',Brown:'#6b4f2e',Slate:'#4d5560'};
const exitArrows={north:'↑',northeast:'↗',east:'→',southeast:'↘',south:'↓',southwest:'↙',west:'←',northwest:'↖'};
function tradeskillName(marker){return marker.category==='Tradeskill'?marker.name.split(/\s+[—–-]\s+/)[0].trim():'';}
function markerSymbol(marker){
  if(marker.toLevel)return text('b',marker.direction==='up'?'↑':'↓');
  if(marker.noteType==='exit')return text('b',exitArrows[marker.arrow]||'→');
  if(marker.noteType==='label')return text('b','Aa','label-glyph');
  const skill=Object.hasOwn(tradePaths,marker.trade||'')?marker.trade:tradeskillName(marker), path=Object.hasOwn(tradePaths,skill)?tradePaths[skill]:(Object.hasOwn(categoryPaths,marker.category)?categoryPaths[marker.category]:null);
  if(!path)return text('b',categories[marker.category][0]);
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true','focusable':'false'}))svg.setAttribute(key,value);
  const shape=document.createElementNS(ns,'path');shape.setAttribute('d',path);if(skill==='Archaeology')shape.setAttribute('transform','rotate(40 12 12)');svg.append(shape);return svg;
}
