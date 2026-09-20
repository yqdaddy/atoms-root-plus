/**
 * 落地页容器组件
 * 整合 Header、Hero、Features、Demo、Footer
 */
import Header from './Header';
import Hero from './Hero';
import Features from './Features';
import Demo from './Demo';
import Footer from './Footer';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-base)]">
      <Header />
      <main>
        <Hero />
        <Features />
        <Demo />
      </main>
      <Footer />
    </div>
  );
}