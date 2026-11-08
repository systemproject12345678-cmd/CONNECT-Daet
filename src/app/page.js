export default function Home() {
  const services = [
    { title: "Tourist Info", desc: "Essential information for visitors including attractions and guidelines.", link: "#" },
    { title: "Digital Museum", desc: "Explore Daet's rich cultural heritage through our interactive inventory.", link: "#" },
    { title: "Local Experiences", desc: "Discover authentic local activities that showcase Daet's unique culture.", link: "#" },
    { title: "Tourism Programs", desc: "Scheduling, promoting, and managing registrations for town fiestas and festivals.", link: "/programs", highlight: true },
    { title: "Local Shop", desc: "Support local artisans and bring home authentic Daet products.", link: "#" },
    { title: "Rewards Program", desc: "Earn points and rewards as you explore Daet and participate in activities.", link: "#" },
  ];

  return (
    <main>
      {/* HERO SECTION */}
      <section className="bg-blue-600 py-20 text-center text-white">
        <h2 className="text-5xl font-bold mb-4">Welcome to CONNECT-Daet</h2>
        <p className="text-xl text-blue-100 mb-8">Your Smart Tourism Gateway to the Municipality of Daet</p>
        <button className="bg-white text-blue-600 px-8 py-3 rounded-full font-bold shadow-lg hover:bg-blue-50 transition-all">
          Explore Daet
        </button>
      </section>

      {/* SERVICES GRID */}
      <section className="max-w-6xl mx-auto py-16 px-4">
        <h3 className="text-3xl font-bold text-center text-gray-800 mb-12 italic">Explore Our Services</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <div key={index} className={`p-8 rounded-2xl border shadow-sm flex flex-col justify-between ${service.highlight ? 'border-blue-400 bg-blue-50' : 'border-gray-100 bg-white'}`}>
              <div>
                <h4 className="text-xl font-bold mb-3">{service.title}</h4>
                <p className="text-gray-500 text-sm leading-relaxed mb-6">{service.desc}</p>
              </div>
              <a href={service.link} className="w-full bg-blue-600 text-white text-center py-3 rounded-xl font-bold hover:bg-blue-700 transition-colors">
                {service.highlight ? "Open Module" : "Learn More"}
              </a>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}