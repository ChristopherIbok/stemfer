import NavBar from '@/components/ui/NavBar';

export default function TransferLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <NavBar />
      <div className="pt-16">
        {children}
      </div>
    </div>
  );
}
