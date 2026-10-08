// Fixed QR version 4-L encoder for short opaque R12 access tokens (up to 78 UTF-8 bytes).
const VERSION=4, SIZE=33, DATA_CODEWORDS=80, ECC_CODEWORDS=20;
const multiply=(x:number,y:number)=>{let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);z^=((y>>>i)&1)*x;}return z;};
function divisor(degree:number){const result=new Uint8Array(degree);result[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){result[j]=multiply(result[j],root);if(j+1<degree)result[j]^=result[j+1];}root=multiply(root,2);}return result;}
function remainder(data:Uint8Array,div:Uint8Array){const result=new Uint8Array(div.length);for(const value of data){const factor=value^result[0];result.copyWithin(0,1);result[result.length-1]=0;for(let i=0;i<result.length;i++)result[i]^=multiply(div[i],factor);}return result;}
function append(bits:number[],value:number,length:number){for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);}
export function accessQrMatrix(value:string){
  const bytes=new TextEncoder().encode(value);if(bytes.length>78)throw new Error("Access QR value is too long");
  const bits:number[]=[];append(bits,0x4,4);append(bits,bytes.length,8);for(const byte of bytes)append(bits,byte,8);append(bits,0,Math.min(4,DATA_CODEWORDS*8-bits.length));while(bits.length%8)bits.push(0);
  const data:number[]=[];for(let i=0;i<bits.length;i+=8){let value=0;for(let j=0;j<8;j++)value=(value<<1)|bits[i+j];data.push(value);}for(let pad=0;data.length<DATA_CODEWORDS;pad++)data.push(pad%2?0x11:0xec);
  const payload=new Uint8Array([...data,...remainder(new Uint8Array(data),divisor(ECC_CODEWORDS))]);const stream:number[]=[];for(const byte of payload)append(stream,byte,8);append(stream,0,7);
  const matrix=Array.from({length:SIZE},()=>Array<boolean>(SIZE).fill(false));const fn=Array.from({length:SIZE},()=>Array<boolean>(SIZE).fill(false));
  const set=(x:number,y:number,dark:boolean)=>{if(x>=0&&y>=0&&x<SIZE&&y<SIZE){matrix[y][x]=dark;fn[y][x]=true;}};
  const finder=(cx:number,cy:number)=>{for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const distance=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,distance!==2&&distance!==4);}};
  finder(3,3);finder(SIZE-4,3);finder(3,SIZE-4);for(let i=8;i<SIZE-8;i++){set(6,i,i%2===0);set(i,6,i%2===0);}for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(26+dx,26+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  const reserveFormat=()=>{for(let i=0;i<=5;i++)set(8,i,false);set(8,7,false);set(8,8,false);set(7,8,false);for(let i=9;i<15;i++)set(14-i,8,false);for(let i=0;i<8;i++)set(SIZE-1-i,8,false);for(let i=8;i<15;i++)set(8,SIZE-15+i,false);set(8,SIZE-8,true);};reserveFormat();
  let index=0;for(let right=SIZE-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<SIZE;vertical++){const upward=((right+1)&2)===0;const y=upward?SIZE-1-vertical:vertical;for(let offset=0;offset<2;offset++){const x=right-offset;if(fn[y][x])continue;const bit=stream[index++]===1;matrix[y][x]=bit!==((x+y)%2===0);}}}
  if(index!==stream.length)throw new Error("Access QR layout is invalid");
  let format=(1<<3)|0,rem=format;for(let i=0;i<10;i++)rem=(rem<<1)^(((rem>>>9)&1)*0x537);format=((format<<10)|rem)^0x5412;const formatBit=(i:number)=>((format>>>i)&1)!==0;
  for(let i=0;i<=5;i++)matrix[i][8]=formatBit(i);matrix[7][8]=formatBit(6);matrix[8][8]=formatBit(7);matrix[8][7]=formatBit(8);for(let i=9;i<15;i++)matrix[8][14-i]=formatBit(i);for(let i=0;i<8;i++)matrix[8][SIZE-1-i]=formatBit(i);for(let i=8;i<15;i++)matrix[SIZE-15+i][8]=formatBit(i);matrix[SIZE-8][8]=true;
  return matrix;
}
