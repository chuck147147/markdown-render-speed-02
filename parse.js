// Independent block reader and inline delimiter processor. Document references
// are collected before rendering, so forward references work at every depth.
const destinationSpaceRE = /[ \t]*(?:\n[ \t]*)?/y;
const destinationSpecialRE = /[\\ \t\n()]/g;
const escapedPunctuationRE = /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/;
const bareUrlRE = /(?:(?:https?|ftp):\/\/|www\.)[^\s<>]+/iy;
const bareEmailRE = /(?:mailto:|xmpp:)?[a-z\d.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]+(?:\/[^\s/]+)?/iy;
// Sticky patterns match at an offset without creating a suffix string.
const angleAutolinkRE = /<([a-z][a-z\d+.-]{1,31}:[^\s<>]*|[a-z\d.!#$%&'*+/=?^_`{|}~-]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+)>/iy;
const inlineHtmlRE = /(?:<!--(?:>|->|[\s\S]*?-->)|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![A-Z][\s\S]*?>|<\/?[A-Za-z][\w-]*(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)/y;
const backtickRunRE = /`+/y;
const labelHtmlRE = /(?:<!--[\s\S]*?-->|<[^>]*>)/y;
const inlineEntityRE = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);/iy;
function execAt(re,s,i){re.lastIndex=i;return re.exec(s);}
const leadingSpacesRE = /^ */;
const listMarkerRE = /^([ ]{0,3})([*+-]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/;
const thematicBreakRE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const fenceRE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const headingRE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)|\s*)$/;
const quotePrefixRE = /^ {0,3}>/;
const codeIndentRE = /^ {4}/;
const setextRE = /^ {0,3}(?:=+|-+) *$/;
const emailPreviousRE = /[\w.+-]/;
const punctuation = /[\p{P}\p{S}]/u;
// ASCII delimiter classification avoids repeated Unicode regex calls.
const asciiWhite = new Uint8Array(128), asciiPunct = new Uint8Array(128);
for (let i=0;i<128;i++) { const c=String.fromCharCode(i); asciiWhite[i]=/\s/u.test(c); asciiPunct[i]=punctuation.test(c); }
const white = c => !c || (c.charCodeAt(0)<128 ? asciiWhite[c.charCodeAt(0)] : /\s/u.test(c));
const punct = c => !!c && (c.charCodeAt(0)<128 ? asciiPunct[c.charCodeAt(0)] : punctuation.test(c));
const escapeChars = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escape = (s, all = false) => !/[&<>"']/.test(s) ? s : s.replace(all ? /[&<>"']/g : /&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)|[<>"']/gi, c => escapeChars[c]);
const unescapeMD = s => !s.includes('\\') ? s : s.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
const inlineStop = new Uint8Array(128);
for(const c of '\\`<>[*_~&\n\"\'')inlineStop[c.charCodeAt(0)]=1;
const stateKey = Symbol('inline context');
const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',copy:'©',AElig:'Æ'};
function decode(s) { return s.replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]*);/gi,(m,n)=> n[0]==='#' ? String.fromCodePoint(Math.min(0x10ffff,parseInt(n.slice(n[1]?.toLowerCase()==='x'?2:1), n[1]?.toLowerCase()==='x'?16:10))||0xfffd) : entities[n]??m); }
function url(s) { try { return encodeURI(s).replace(/%25/g,'%'); } catch { return null; } }
const label = s => s.trim().replace(/\s+/g,' ').toLowerCase().replace(/ß/g,'ss');
function destination(s, start) {
  let i=start; while ((s[i]===' '||s[i]==='\t') && i<s.length) i++;
  let href='', title;
  if(s[i]==='<') {
    let j=i+1; for(;j<s.length;j++){if(s[j]==='\\'){j++;continue;}if(s[j]==='>')break;if(s[j]==='\n'||s[j]==='<')return null;}
    if(j===s.length)return null;href=s.slice(i+1,j);i=j+1;
  } else {
    let j=i,depth=0;for(;j<s.length;){destinationSpecialRE.lastIndex=j;const special=destinationSpecialRE.exec(s);if(!special){j=s.length;break;}j=special.index;const c=s[j];if(c==='\\'&&j+1<s.length){j+=2;continue;}if(c===' '||c==='\t'||c==='\n')break;if(c==='(')depth++;if(c===')'){if(!depth)break;depth--;}j++;}
    if(depth)return null;href=s.slice(i,j);i=j;
  }
  const hrefEnd=i;let ws=execAt(destinationSpaceRE,s,i)[0];i+=ws.length;
  if(ws && /["'(]/.test(s[i]||'~')) {const end=s[i]==='('?')':s[i];let j=i+1;for(;j<s.length;j++){if(s[j]==='\\'){j++;continue;}if(s[j]===end)break;}if(j<s.length&&!s.slice(i+1,j).includes('\n\n')){title=s.slice(i+1,j);i=j+1;while(s[i]===' '||s[i]==='\t')i++;}else i=hrefEnd;}
  else i=hrefEnd;
  while(s[i]===' '||s[i]==='\t')i++;
  return {href:unescapeMD(href),title:title===undefined?undefined:unescapeMD(title),end:i};
}
function autoTail(value){
  let s=value.replace(/&[a-z\d]+;$/i,'');const protectedEnds=new Set();
  for(let q=0;q<s.length;q++)if(s[q]==='('){const end=s.indexOf(')',q+1);if(end<0){s=s.slice(0,q);break;}protectedEnds.add(end);q=end;}
  while(s&&(/[?!.,:;*_'"~]/.test(s.at(-1))||s.at(-1)===')'&&!protectedEnds.has(s.length-1)))s=s.slice(0,-1);
  return s;
}
function hasBrokenCode(s){for(let q=0;q<s.length;q++){if(s[q]==='\\'){q++;continue;}if(s[q]!=='`')continue;let n=1;while(s[q+n]==='`')n++;let found=false;for(let r=q+n;r<s.length;r++){if(s[r]!=='`')continue;let end=r+1;while(s[end]==='`')end++;if(end-r===n){q=end-1;found=true;break;}r=end-1;}if(!found)return true;}return false;}
const emailLocal = new Uint8Array(128);
for(let i=0;i<128;i++)emailLocal[i]=/[a-z\d.!#$%&'*+/=?^_`{|}~-]/i.test(String.fromCharCode(i));
function proseEnd(s,i,hasAutoURL,limit=s.length){
  let j=i;
  for(;j<limit;j++){
    const v=s.charCodeAt(j);
    if(inlineStop[v]||v===33&&s.charCodeAt(j+1)===91)break;
    if(v===32){let end=j+1;while(s.charCodeAt(end)===32)end++;if(s.charCodeAt(end)===10)break;j=end-1;continue;}
    if(hasAutoURL&&(v===104||v===72||v===102||v===70||v===119)){
      const prev=s.charCodeAt(j-1);
      if(!(prev>=97&&prev<=122||prev>=65&&prev<=90||prev>=48&&prev<=57))break;
    }
  }
  return j;
}
function inline(s, refs, inLink=false, raw=false) {
  if(!/[\\`<>\[\]*_~&\n\"'@]|:\/\/|www\./.test(s))return s;
  const hasEmail=s.includes('@');
  const hasAutoURL=!inLink && /(?:https?|ftp):\/\/|www\./i.test(s);
  let emailAt=-1,emailStart=0;
  let nodes=[], ds=[], pairs=[], failedLabels=[], activeMasks=[];
  let codeMasks;
  const getCodeMasks=()=>{
    if(codeMasks)return codeMasks;
    codeMasks=[];let runs=[];for(let q=s.indexOf('`');q>=0;q=s.indexOf('`',q+1))if(s[q]==='`'){let e=q+1;while(s[e]==='`')e++;runs.push([q,e]);q=e-1;}for(let q=0;q+1<runs.length;q++){if(runs[q][1]-runs[q][0]===runs[q+1][1]-runs[q+1][0]){codeMasks.push([runs[q][0],runs[q+1][1]]);q++;}}
  for(let q=0;q<runs.length;q++){for(let r=q+1;r<runs.length;r++)if(runs[q][1]-runs[q][0]===runs[r][1]-runs[r][0]){codeMasks.push([runs[q][0],runs[r][1]]);q=r;break;}}
    return codeMasks;
  };
  const put = value => {const k=nodes.length-1;if(typeof nodes[k]==='string')nodes[k]+=value;else nodes.push(value);};
  for(let i=0;i<s.length;) {
    // Copy ordinary prose in spans, retaining token boundaries for autolinks.
    {
      if(hasEmail&&i>emailAt){
        emailAt=s.indexOf('@',i);
        emailStart=emailAt<0?s.length:emailAt;
        if(emailAt<0)emailAt=s.length;
        else {
          // Keep possible local parts and mailto:/xmpp: prefixes on the token path.
          while(emailStart>i&&emailLocal[s.charCodeAt(emailStart-1)])emailStart--;
          if(s[emailStart-1]===':')emailStart=Math.max(i,emailStart-8);
        }
      }
      const j=proseEnd(s,i,hasAutoURL,hasEmail?Math.max(i,emailStart):s.length);
      if(j>i){put(s.slice(i,j));i=j;if(i===s.length)break;}
    }
    const c=s[i]; let m;
    if(c==='\\' && i+1<s.length) { if(s[i+1]==='\n'){put('<br>');i+=2;while(s[i]===' ')i++;continue;} if(escapedPunctuationRE.test(s[i+1])){put(escape(s[i+1]));i+=2;continue;} }
    if(c==='`') { let n=1;while(s[i+n]==='`')n++;let j=i+n,found=-1;while(j<s.length){j=s.indexOf('`',j);if(j<0)break;let k=j;while(s[k]==='`')k++;if(k-j===n){found=j;break;}j=k;}if(found>=0){let v=s.slice(i+n,found).replace(/\n/g,' ');if(v.startsWith(' ')&&v.endsWith(' ')&&/[^ ]/.test(v))v=v.slice(1,-1);put('<code>'+escape(v,true)+'</code>');i=found+n;continue;}put('`'.repeat(n));i+=n;continue; }
    if(c==='<' && (m=execAt(angleAutolinkRE,s,i))) {let v=m[1],h=v.includes('@')&&!/^[a-z][\w+.-]*:/i.test(v)?'mailto:'+v:v;put('<a href="'+escape(url(h))+'">'+escape(v)+'</a>');i+=m[0].length;continue;}
    if(c==='<' && !/^<\/[A-Za-z][\w-]*\s+[^>\s]/.test(s.slice(i)) && (m=execAt(inlineHtmlRE,s,i))){put(m[0]);if(/^<a(?:\s|>)/i.test(m[0]))refs[stateKey].link=true;else if(/^<\/a\s*>/i.test(m[0]))refs[stateKey].link=false;if(/^<\/?(?:pre|code|kbd|script)(?:\s|>)/i.test(m[0]))raw=!/^<\//.test(m[0]);i+=m[0].length;continue;}
    if(c==='[' || (c==='!'&&s[i+1]==='[')) {
      const img=c==='!', b=i+(img?1:0);let j=b+1, depth=1;
      for(;j<s.length;j++){if(s[j]==='\\'){j++;continue;}if(s[j]==='`'){let z=execAt(backtickRunRE,s,j)[0];if(z.length>=2&&s[j+z.length]===']'){j+=z.length-1;continue;}let e=s.indexOf('`',j+z.length);if(e>=0){while(s[e]==='`')e++;j=e-1;continue;}}if(s[j]==='<'){let h=execAt(labelHtmlRE,s,j);if(h){j+=h[0].length-1;continue;}}if(s[j]==='[')depth++;if(s[j]===']'&&!--depth)break;}
      if(j<s.length){let text=s.slice(b+1,j), data=null,end=j+1;
        if(s[end]==='('){const d=destination(s,end+1);if(d&&s[d.end]===')'){data=d;end=d.end+1;}}
        if(!data){let key=text;if(s[end]==='['){let e=s.indexOf(']',end+1);if(e>=0){key=s.slice(end+1,e)||text;end=e+1;}}data=refs[label(key)];}
        let validLabel=true;for(let q=0;q<text.length;q++){if(text[q]==='\\'){q++;continue;}if(text[q]!=='`')continue;let end=q;while(text[end]==='`')end++;let next=text.indexOf('`',end);if(next<0){if(end-q<2||end!==text.length){data=null;validLabel=false;}break;}while(text[next]==='`')next++;q=next-1;}
        
        if(!validLabel)failedLabels.push([b+1,j]);
        if(data && (img || !inLink || inLink==='probe') && (img || !text.includes('[') || !inline(text.replace(/<[^>]*>/g,''),refs,'probe').includes('<a href='))) {const h=url(data.href);if(h!==null){const title=data.title===undefined?'':' title="'+escape(data.title)+'"';if(img){let alt=inline(text,refs,false).replace(/<img[^>]* alt="([^"]*)"[^>]*>/g,'$1').replace(/<[^>]*>/g,'');put('<img src="'+escape(h)+'" alt="'+alt+'"'+title+'>');}else put('<a href="'+escape(h)+'"'+title+'>'+inline(text,refs,true)+'</a>');if(text.includes('`')&&hasBrokenCode(text))for(const mask of getCodeMasks())if(mask[0]>=i&&mask[0]<end&&mask[1]>end)activeMasks.push(mask);i=end;continue;}}
      }
    }
    if((c==='*'||c==='_'||c==='~') && !raw) {
      let n=1;while(s[i+n]===c)n++; if(c==='~'&&n>2){put('~'.repeat(n));i+=n;continue;}
      if(activeMasks.some(([a,b])=>i>=a&&i<b)||c==='_'&&failedLabels.some(([a,b])=>i>=a&&i<b)){put(c.repeat(n));i+=n;continue;}
      const prev=s[i-1], next=s[i+n];const left=!white(next)&&(!punct(next)||white(prev)||punct(prev));const right=!white(prev)&&(!punct(prev)||white(next)||punct(next));
      const d={ch:c,n,original:n,open:c==='_'?left&&(!right||punct(prev)):left,close:c==='_'?right&&(!left||punct(next)):right,index:nodes.length,pos:i,canOpen:c==='_'?left&&(!right||punct(prev)):left,before:'',after:''};nodes.push(d);ds.push(d);i+=n;continue;
    }
    if(!inLink&&!refs[stateKey].link&&!raw&&(c==='h'||c==='H'||c==='f'||c==='F'||c==='w')&&(m=execAt(bareUrlRE,s,i))){let v=autoTail(m[0]);if(v&&!/^www\./i.test(v)||v.startsWith('www.')){put('<a href="'+escape(url(v.startsWith('www.')?'http://'+v:v))+'">'+escape(v)+'</a>');i+=v.length;continue;}}
    if(hasEmail&&!inLink&&!refs[stateKey].link&&!raw&&c!==' '&&c!=='\n'&&(i===0||!emailPreviousRE.test(s[i-1]))&&(m=execAt(bareEmailRE,s,i))){let v=m[0];if(/[-_]/.test(s[i+v.length]||' ' )&&!(s[i+v.length]==='_'&&ds.some(d=>d.ch==='_'&&d.open))) {put(escape(c));i++;continue;}if(!v.startsWith('xmpp:'))v=v.split('/')[0];put('<a href="'+(/^(?:mailto|xmpp):/.test(v)?'':'mailto:')+v+'">'+v+'</a>');i+=v.length;continue;}
    if(c===' '){let j=i+1;while(s[j]===' ')j++;if(s[j]==='\n'){const hard=j-i>=2;put(hard?'<br>':s.slice(i,j+1));i=j+1;if(hard)while(s[i]===' ')i++;continue;}put(s.slice(i,j));i=j;continue;}
    if(c==='\n'){put('\n');i++;continue;}
    if(c==='&' && (m=execAt(inlineEntityRE,s,i))){put(/^&#(?:\d{1,7}|x[\da-f]{1,6});$/i.test(m[0])?escape(decode(m[0]),true): /^&#/.test(m[0])?escape(m[0],true):m[0]);i+=m[0].length;continue;}
    if((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')){let j=i+1;while(j<s.length){const v=s.charCodeAt(j);if(!(v>=97&&v<=122||v>=65&&v<=90||v>=48&&v<=57))break;j++;}let end=j;while(s[end]===' ')end++;if(s[end]!=='\n')j=end;put(s.slice(i,j));i=j;continue;}
    put(raw?c:c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='\"'?'&quot;':c==="'"?'&#39;':c);i++;
  }
  for(let k=0;k<ds.length;k++){
    const close=ds[k];if(!close.close)continue;
    for(let p=k-1;p>=0&&close.n;p--){const open=ds[p];if(open.ch!==close.ch||!open.open||!open.n)continue;if(close.ch==='~'&&open.n!==close.n)continue;
      if(close.ch!=='~'&&(open.close||close.open)&&(open.original+close.original)%3===0&&(open.original%3!==0||close.original%3!==0))continue;
      if(open.n>=2&&close.n===1&&pairs.some(pair=>pair.tag==='em'&&pair.open.index>open.index&&pair.close.index<close.index&&pair.close.canOpen)&&ds.slice(k+1).some(d=>d.ch===open.ch&&d.close&&d.n>=2))continue;
      const take=close.ch==='~'?close.n:Math.min(open.n,close.n)>=2?2:1;const tag=close.ch==='~'?'del':take===2?'strong':'em';open.n-=take;close.n-=take;pairs.push({open,close,take,tag});
      for(let q=p+1;q<k;q++)ds[q].open=false;
      if(open.n&&close.n)p++;
    }
  }
  for(const pair of pairs){
    if(pair.tag==='em'&&pair.open.ch==='*'&&pairs.some(inner=>inner.tag==='strong'&&inner.open.ch===pair.open.ch&&inner.open.index>pair.open.index&&inner.close.index<pair.close.index&&!inner.open.close&&inner.close.canOpen)){
      pair.open.n+=pair.take;pair.close.n+=pair.take;pair.cancelled=true;
    }
  }
  for(const pair of pairs){if(pair.cancelled)continue;pair.open.after='<'+pair.tag+'>'+pair.open.after;pair.close.before+='</'+pair.tag+'>';if(pair.tag==='strong'&&pair.close.n&&pairs.some(inner=>inner.tag==='em'&&inner.open.index>pair.open.index&&inner.close.index<pair.close.index&&inner.close.canOpen))pair.close.inside=true;}
  for(let i=0;i<nodes.length;i++){const n=nodes[i];nodes[i]=typeof n!=='string'?(n.inside?n.ch.repeat(n.n)+n.before:n.before+n.ch.repeat(n.n))+n.after:n;}
  return nodes.join('');
}
const fence = s => {let i=0;while(i<4&&s.charCodeAt(i)===32)i++;const c=s.charCodeAt(i);return i<4&&(c===96||c===126)&&s.charCodeAt(i+1)===c&&s.charCodeAt(i+2)===c ? fenceRE.exec(s) : null;};
const rule = s => thematicBreakRE.test(s);
const marker = s => {let i=0;while(i<4&&s.charCodeAt(i)===32)i++;const c=s.charCodeAt(i);return i<4&&(c===42||c===43||c===45||c>=48&&c<=57)?listMarkerRE.exec(s):null;};
const blockTags='address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const htmlBlock = new RegExp('^ {0,3}</?(?:'+blockTags+')(?:\\s|/?>|$)','i');
function htmlKind(s) { if(s[0]!=='<'&&s[1]!=='<'&&s[2]!=='<'&&s[3]!=='<')return 0; if(/^ {0,3}<\/[A-Za-z][\w-]*\s+[^>\s]/.test(s))return 0; if(/^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.test(s))return 1;if(/^ {0,3}<!--/.test(s))return 2;if(/^ {0,3}<\?/.test(s))return 3;if(/^ {0,3}<![A-Z]/.test(s))return 4;if(/^ {0,3}<!\[CDATA\[/.test(s))return 5;if(htmlBlock.test(s))return 6;if(/^ {0,3}<\/?[A-Za-z][\w-]*(?:\s+[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>\s*$/.test(s))return 7;return 0; }
function interrupt(s) {
  let at=0;while(at<4&&s.charCodeAt(at)===32)at++;const c=s.charCodeAt(at);
  if(at===4)return false;
  if(c===35||c===62)return /^ {0,3}(?:#{1,6}(?:\s|$)|>)/.test(s);
  if(c===96||c===126){const f=fence(s);return !!f&&!(f[1][0]==='`'&&f[2].includes('`'));}
  if(c===60){const kind=htmlKind(s);return kind>0&&kind<7;}
  if(c===42||c===45||c===95){if(rule(s))return true;}
  else if(!(c===43||c>=48&&c<=57))return false;
  const m=marker(s);return !!m&&(m[2].length===1||parseInt(m[2])===1)&&!!m[4];
}
function cells(s) {
  s=s.trim();let start=s[0]==='|'?1:0,end=s.length;if(s[end-1]==='|')end--;
  let out=[],part='',segment=start;
  for(let i=start;i<end;i++){
    if(s[i]==='\\'&&s[i+1]==='|'&&i+1<end){part+=s.slice(segment,i)+'|';i++;segment=i+1;}
    else if(s[i]==='|'&&(i===start||s[i-1]!=='\\')){out.push((part+s.slice(segment,i)).trim());part='';segment=i+1;}
  }
  out.push((part+s.slice(segment,end)).trim());return out;
}
// Reject ordinary link lines before assembling a potentially large reference suffix.
function possibleDefinition(s) {
  let i=0;while(s[i]===' ')i++;if(i>3||s[i]!=='[')return false;
  for(i++;i<s.length;i++){
    if(s[i]==='\\'){i++;continue;}
    if(s[i]==='[')return false;
    if(s[i]===']')return s[i+1]===':';
  }
  return true; // A reference label may continue on the following line.
}
function blocks(lines, refs, nested=false) {
  const originals=lines;
  const finalNewline=lines.finalNewline;
  let activeFence=null, activeEnd=null;
  if(lines.some(line=>line.includes('\t')))lines=lines.map(line=>{if(activeFence){if(activeEnd.test(line))activeFence=null;return line;}let col=0;if(line.includes('\t'))line=line.replace(/^[ \t]+/,part=>{let r='';for(const ch of part){let n=ch==='\t'?4-col%4:1;r+=' '.repeat(n);col+=n;}return r;});let f=fence(line);if(f&&!(f[1][0]==='`'&&f[2].includes('`'))){activeFence=f[1];activeEnd=new RegExp('^ {0,3}'+f[1][0]+'{'+f[1].length+',} *$');}return line;});
  lines.finalNewline=finalNewline;
  let out=[];
  for(let i=0;i<lines.length;) {
    let s=lines[i], m;
    if(!s.trim()){if(out.length)out.hasBlank=true;i++;continue;}
    if((m=fence(s)) && !(m[1][0]==='`'&&m[2].includes('`'))) {const indent=m[1][0]==='~'?0:leadingSpacesRE.exec(s)[0].length, ch=m[1][0], n=m[1].length;let code=[],j=i+1;const closing=new RegExp('^ {0,3}'+ch+'{'+n+',} *$'),dedent=new RegExp('^[ \\t]{0,'+indent+'}');for(;j<lines.length;j++){if(closing.test(lines[j]))break;code.push(indent?originals[j].replace(dedent,''):originals[j]);}out.push({type:'code',text:code.join('\n'),lang:unescapeMD(m[2].trim().split(/\s/)[0])});i=j<lines.length?j+1:j;continue;}
    if(codeIndentRE.test(s)){let a=[],j=i;for(;j<lines.length;j++){if(codeIndentRE.test(lines[j]))a.push(originals[j].replace(/^(?: {4}| {0,3}\t)/,''));else if(!lines[j].trim())a.push('');else break;}while(a.at(-1)==='')a.pop();out.push({type:'code',text:a.join('\n')});i=j;continue;}
    if((m=headingRE.exec(s))){out.push({type:'heading',level:m[1].length,text:(m[2]||'').replace(/(?:\s+#+\s*|^#+\s*)$/,'').trim()});i++;continue;}
    if(rule(s)){out.push({type:'hr'});i++;continue;}
    if(quotePrefixRE.test(s)){
      let a=[],j=i,lazy=false,quotedFence=false;const lazyLines=[];
      for(;j<lines.length;j++){
        let t=lines[j];
        if(quotePrefixRE.test(t)){
          const prefix=quotePrefixRE.exec(t)[0];t=t.slice(prefix.length);
          {let col=prefix.length;if(t.includes('\t'))t=t.replace(/^[ \t]+/,p=>{let r='';for(const c of p){let n=c==='\t'?4-col%4:1;r+=' '.repeat(n);col+=n;}return r;});}
          t=t.replace(/^ /,'');a.push(t);
          let f=fence(t);if(f&&!(f[1][0]==='`'&&f[2].includes('`'))){if(!quotedFence)quotedFence=f[1];else if(f[1][0]===quotedFence[0]&&f[1].length>=quotedFence.length&&!f[2].trim())quotedFence=false;}
          lazy=!!t.trim()&&!quotedFence&&!codeIndentRE.test(t)&&!htmlKind(t)&&!rule(t);
        }else if(t.trim()&&lazy&&!interrupt(t)){if(setextRE.test(t))a.push('    '+t);else {lazyLines.push(a.length);a.push(t);}}
        else break;
      }
      a.finalNewline=j<lines.length?!(!lines[j].trim()):lines.finalNewline;
      const children=blocks(a,refs,true);if(lazyLines.length)for(const node of children)if(node.type==='paragraph')node.text=node.text.replace(/\n {4}(?=[*+-] )/g,'\n');out.push({type:'quote',children});i=j;continue;
    }
    if((m=marker(s))){const ordered=m[2].length>1, bullet=ordered?m[2].at(-1):m[2],start=ordered?parseInt(m[2]):undefined;let items=[],j=i,loose=false;
      while(j<lines.length){let line=lines[j];if(line.includes('\t'))line=line.replace(/^([ ]{0,3}(?:[*+-]|\d{1,9}[.)]))([ \t]+)/,(all,p,w)=>{let col=p.length;return p+[...w].map(c=>{let n=c==='\t'?4-col%4:1;col+=n;return ' '.repeat(n);}).join('');});let mm=marker(line);if(!mm|| (mm[2].length>1)!==ordered||(ordered?mm[2].at(-1):mm[2])!==bullet||rule(lines[j]))break;
        let pad=mm[1].length+mm[2].length,spaces=(mm[3]||' ').length;let body=mm[4]||'';if(!body){spaces=1;}if(spaces>4){body=' '.repeat(spaces-1)+body;spaces=1;}pad+=spaces;let a=[body],k=j+1,blank=false;
        for(;k<lines.length;k++){let t=lines[k];if(!t.trim()){if(a.length===1&&!a[0]){let next=k;while(next<lines.length&&!lines[next].trim())next++;if(!marker(lines[next]||''))break;}a.push('');blank=true;continue;}if(t.includes('\t'))t=t.replace(/^[ \t]+/,p=>{let col=0,r='';for(const c of p){let n=c==='\t'?4-col%4:1;col+=n;r+=' '.repeat(n);}return r;});const ind=leadingSpacesRE.exec(t)[0].length;if(ind>=pad){a.push(t.slice(pad));blank=false;continue;}if(marker(t)||rule(t))break;if(blank||interrupt(t)||fence(a.at(-1)||'')&&! (fence(a.at(-1))[1][0]==='`'&&fence(a.at(-1))[2].includes('`')))break;a.push(t);}
        let trailing=0;while(a.length>1&&a.at(-1)===''){a.pop();trailing++;}if(trailing){let next=marker(lines[k]||'');if(next&&(next[2].length>1)===ordered&&(ordered?next[2].at(-1):next[2])===bullet)loose=true;}
        let task=null;if(/^\[[ xX]\](?:\s|$)/.test(a[0])){task=a[0][1].toLowerCase()==='x';a[0]=a[0].slice(3).replace(/^ +/,'');}
        while(a[0]===''&&a.length>1)a.shift();const children=blocks(a,refs,'list');if(children.hasBlank)loose=true;items.push({children,task});j=k;
      }
      if(j===i){out.push({type:'paragraph',text:s});i++;continue;}out.push({type:'list',ordered,start,items,loose});if(j<lines.length&&j>0&&!lines[j-1].trim())out.hasBlank=true;i=j;continue;
    }
    let kind=htmlKind(s);
    if(kind){let a=[],j=i,stop=kind===1?new RegExp('</'+/^ {0,3}<([\w]+)/.exec(s)[1]+'\\s*>','i'):kind===2?/-->/:kind===3?/\?>/:kind===4?/>/:kind===5?/\]\]>/:null;
      for(;j<lines.length;j++){if(kind>=6&&!lines[j].trim())break;a.push(originals[j]);if(stop?.test(lines[j])){j++;break;}}out.push({type:'html',text:a.join('\n')+(j<lines.length&&(kind>=6?!lines[j].trim():lines[j]==='')?'':j<lines.length||lines.finalNewline?'\n':'')});i=j;continue;}
    // Labels and titles cannot cross a blank line; avoid joining the document tail.
    if(possibleDefinition(s)) {let end=i+1;while(end<lines.length&&lines[end]!=='')end++;let text=lines.slice(i,end).join('\n')+(end<lines.length?'\n\n':'');let d=/^ {0,3}\[((?:\\.|[^\]\[\\])+)\]:[ \t]*(?:\n[ \t]*)?/.exec(text);if(d&&label(d[1])&&!d[0].includes('\n\n')){let dest=destination(text,d[0].length);if(dest?.title!==undefined && text[dest.end]&&text[dest.end]!=='\n'){let first=text.indexOf('\n',d[0].length);if(first>=0)dest=destination(text.slice(0,first),d[0].length);}if(dest && (dest.href || text[d[0].length]==='<') && (text[dest.end]==='\n'||dest.end===text.length||text.slice(dest.end).trim()==='')){let consumed=text.slice(0,dest.end).split('\n').length-1;if(text[dest.end]==='\n'||dest.end===text.length)consumed++;if(!refs[label(d[1])])refs[label(d[1])]=dest;i+=Math.max(1,consumed);continue;}}}
    if(i+1<lines.length && s.includes('|')&&/^ {0,3}\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/.test(lines[i+1])){const head=cells(s),ds=cells(lines[i+1]);if(head.length===ds.length){let rows=[],j=i+2;for(;j<lines.length&&(originals[j].includes('\t')||lines[j].trim())&&!interrupt(lines[j]);j++)rows.push(cells(lines[j]));out.push({type:'table',head,align:ds.map(x=>x.startsWith(':')?(x.endsWith(':')?'center':'left'):x.endsWith(':')?'right':null),rows});i=j;continue;}}
    let a=[s],j=i+1,setext=0;
    for(;j<lines.length;j++){if(!lines[j].trim()){if(j===lines.length-1&&lines[j]!==''&&nested===true)a.push(lines[j]),j++;break;}if(setextRE.test(lines[j])){setext=lines[j].trim()[0]==='='?1:2;j++;break;}if(interrupt(lines[j])||nested==='list'&&marker(lines[j]))break;a.push(lines[j]);}
    out.push({type:setext?'heading':'paragraph',level:setext,text:setext?a.join('\n').trim():nested==='list'?a.map(x=>x.replace(/^ {4,}/,'')).join('\n'):a.join('\n')});i=j;
  }
  return out;
}
function render(tree,refs,tight=false){let result='';for(const n of tree){switch(n.type){case 'paragraph':result+=(tight?'':'<p>')+inline(n.text,refs)+(tight?'':'</p>\n');break;case 'heading':result+='<h'+n.level+'>'+inline(n.text,refs)+'</h'+n.level+'>\n';break;case 'hr':result+='<hr>\n';break;case 'code':result+='<pre><code'+(n.lang?' class="language-'+escape(n.lang)+'"':'')+'>'+escape(n.text.replace(/\n$/,''),true)+(n.text?'\n':'')+'</code></pre>\n';break;case 'html':result+=n.text;break;case 'quote':result+='<blockquote>\n'+render(n.children,refs)+'</blockquote>\n';break;case 'list':{const tag=n.ordered?'ol':'ul';result+='<'+tag+(n.ordered&&n.start!==1?' start="'+n.start+'"':'')+'>\n';for(const item of n.items){let text=render(item.children,refs,!n.loose);if(item.task!==null){let box='<input '+(item.task?'checked="" ':'')+'disabled="" type="checkbox"> ';if(n.loose&&text.startsWith('<p>'))text='<p>'+box+text.slice(3);else text=box+text;}result+='<li>'+text+'</li>\n';}result+='</'+tag+'>\n';break;}case 'table':{const row=(r,tag)=>'<tr>\n'+n.head.map((_,i)=>'<'+tag+(n.align[i]?' align="'+n.align[i]+'"':'')+'>'+inline(r[i]||'',refs)+'</'+tag+'>\n').join('')+'</tr>\n';result+='<table>\n<thead>\n'+row(n.head,'th')+'</thead>\n'+(n.rows.length?'<tbody>'+n.rows.map(r=>row(r,'td')).join('')+'</tbody>':'')+'</table>\n';break;}}}return result;}
export function parse(markdown){const source=markdown.replace(/\r\n?/g,'\n');const lines=source.split('\n');lines.finalNewline=source.endsWith('\n');if(lines.at(-1)==='')lines.pop();const refs=Object.create(null);refs[stateKey]={link:false};return render(blocks(lines,refs),refs);}
