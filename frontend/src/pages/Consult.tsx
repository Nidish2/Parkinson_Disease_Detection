import { useMemo, useState } from 'react';
import { MapPin, Phone, Video, Clock, Languages, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/Card';
import { parkinsonSpecialists } from '../data/parkinsonSpecialists';

const Consult = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegion, setSelectedRegion] = useState<string>('All');
  const navigate = useNavigate();

  const availableRegions = useMemo(() => ['All', ...new Set(parkinsonSpecialists.map(doc => `${doc.location}, ${doc.state}`))], []);

  const filteredDoctors = useMemo(() => {
    const normalisedSearch = searchTerm.trim().toLowerCase();

    return parkinsonSpecialists.filter((doctor) => {
      const regionMatches = selectedRegion === 'All' || `${doctor.location}, ${doctor.state}` === selectedRegion;
      const searchMatches = !normalisedSearch || [
        doctor.name,
        doctor.title,
        doctor.hospital,
        doctor.location,
        doctor.state,
        doctor.specialties.join(' '),
        doctor.tags.join(' '),
      ].some((value) => value.toLowerCase().includes(normalisedSearch));

      return regionMatches && searchMatches;
    });
  }, [searchTerm, selectedRegion]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-bold">Consult a Parkinson&apos;s Specialist</h2>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Browse trusted neurologists across India who focus on Parkinson’s and related movement disorders. Choose a region or search for particular expertise, then call or request a virtual consultation slot.
          </p>
        </div>
        <div className="flex gap-3 flex-col sm:flex-row">
          <select
            value={selectedRegion}
            onChange={(event) => setSelectedRegion(event.target.value)}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {availableRegions.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search name, hospital, keyword..."
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <Card className="bg-card/70">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <Stethoscope className="h-10 w-10 text-primary-foreground" />
            <div>
              <h3 className="font-semibold">How we curate this list</h3>
              <p className="text-sm text-muted-foreground">
                Doctors listed here have neurology specialisations with a track record in Parkinson’s care. Contact details are provided for convenience; availability can change, so please confirm directly with the hospital or clinic.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground max-w-xs lg:text-right">
            Emergency symptoms such as sudden weakness, chest pain, or confusion require immediate local medical attention—call your nearest hospital or emergency helpline.
          </p>
        </div>
      </Card>

      {filteredDoctors.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <h3 className="text-lg font-semibold text-gray-900">No matches found</h3>
            <p className="text-sm text-gray-600 mt-2">Try clearing your search filters or select &quot;All&quot; regions to view the full list of specialists.</p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {filteredDoctors.map((doctor) => (
            <Card key={doctor.id} className="h-full hover:shadow-xl transition-shadow">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <h3 className="text-xl font-semibold text-gray-900">{doctor.name}</h3>
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">{doctor.yearsExperience}+ yrs</span>
                    </div>
                    <p className="text-sm text-gray-600">{doctor.title}</p>
                    <p className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                      <MapPin className="h-4 w-4 text-blue-600" /> {doctor.hospital}, {doctor.location}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {doctor.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors">{tag}</span>
                    ))}
                  </div>
                </div>

                <p className="text-sm leading-relaxed text-gray-700">{doctor.bio}</p>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                    <p className="text-xs font-semibold uppercase text-gray-600 mb-1">Expertise focus</p>
                    <ul className="space-y-1 text-sm text-gray-700">
                      {doctor.specialties.map((specialty) => (
                        <li key={specialty} className="flex items-start gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden />{specialty}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <Languages className="h-4 w-4 text-blue-600" /> {doctor.languages.join(', ')}
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-xs font-semibold uppercase text-gray-600">Upcoming availability</p>
                      {doctor.nextSlots.map((slot) => (
                        <p key={slot.day} className="flex items-center gap-2 text-sm text-gray-700"><Clock className="h-4 w-4 text-blue-600" /> {slot.day}: {slot.times.join(', ')}</p>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 text-sm text-gray-700">
                    <Phone className="h-4 w-4 text-blue-600" />
                    <a href={`tel:${doctor.phone}`} className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">{doctor.phone}</a>
                    {doctor.videoUrl && (
                      <>
                        <span className="text-gray-400">•</span>
                        <Video className="h-4 w-4 text-blue-600" />
                        <a href={doctor.videoUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline">Request video consult</a>
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/consult/${doctor.id}/book`)}
                    className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 shadow-md hover:shadow-lg"
                  >
                    Check appointment options
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-gray-50 border-dashed border-gray-300">
        <p className="text-xs text-gray-600 text-center">
          The details above are informational and not an endorsement. Always confirm credentials, costs, and emergency protocols with the provider. If you already work with a neurologist you trust, share your Parkinson's care goals with them for continuity.
        </p>
      </Card>
    </div>
  );
};

export default Consult;
