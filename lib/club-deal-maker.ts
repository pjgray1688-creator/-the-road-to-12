export type DealMakerOffer = "percentage" | "money_off" | "fixed_price" | "bundle" | "buy_get_free" | "buy_get_percentage";
/** Launch V1 templates with complete canonical persistence. Other planned
 * templates stay out of the picker until their evaluator effects exist. */
export const dealMakerOffers: Array<{value:DealMakerOffer;label:string}> = [
  {value:"percentage",label:"Percentage off"},{value:"money_off",label:"Money off"},{value:"bundle",label:"X items for £Y"}
];
export function dealSummary(input:{name:string;offer:DealMakerOffer;quantity?:number;value?:number;target:string;repeatable:boolean}) { const target=input.target||"selected products"; if(input.offer==="bundle") return `${input.quantity||0} items for £${(input.value||0).toFixed(2)} on ${target}${input.repeatable?" · repeats for complete groups":""}`; if(input.offer==="buy_get_free") return `Buy ${input.quantity||0}, get the qualifying reward free on ${target}`; if(input.offer==="buy_get_percentage") return `Buy ${input.quantity||0}, get the qualifying reward discounted on ${target}`; return `${input.name||"Offer"} on ${target}`; }
