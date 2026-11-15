// Synchronous SHA-256 for the identical Node/browser planner. No external script loads.
export function createShelterSelectionDigest() {
  const constants=[],initial=[];
  for(let n=2;constants.length<64;n++){
    let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}
    if(!prime)continue;
    if(initial.length<8)initial.push((Math.sqrt(n)%1*4294967296)|0);
    constants.push((Math.cbrt(n)%1*4294967296)|0);
  }
  const rotate=(v,n)=>(v>>>n)|(v<<(32-n)),encoder=new TextEncoder();
  return value=>{
    const input=encoder.encode(JSON.stringify(value)),length=Math.ceil((input.length+9)/64)*64;
    const bytes=new Uint8Array(length);bytes.set(input);bytes[input.length]=128;
    const view=new DataView(bytes.buffer),bits=input.length*8;
    view.setUint32(length-8,Math.floor(bits/4294967296));view.setUint32(length-4,bits>>>0);
    const state=initial.slice(),words=new Int32Array(64);
    for(let offset=0;offset<length;offset+=64){
      for(let i=0;i<16;i++)words[i]=view.getInt32(offset+i*4);
      for(let i=16;i<64;i++){
        const a=words[i-15],b=words[i-2];
        words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))|0;
      }
      let [a,b,c,d,e,f,g,h]=state;
      for(let i=0;i<64;i++){
        const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])|0;
        const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
        h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;
      }
      for(const [i,v] of [a,b,c,d,e,f,g,h].entries())state[i]=(state[i]+v)|0;
    }
    return state.map(v=>(v>>>0).toString(16).padStart(8,'0')).join('');
  };
}
