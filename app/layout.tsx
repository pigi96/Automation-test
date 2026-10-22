import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata={icons:{icon:{url:'/favicon.svg',type:'image/svg+xml'}},title:'Coinpulse — Crypto predictions & market radar',description:'Explore experimental crypto predictions with price charts, news, public social signals and market tools for the top 100 coins.'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
