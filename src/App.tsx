import { Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Play from './pages/Play';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import Lobby from './pages/Lobby';
export default function App(){return <Routes><Route path="/" element={<Landing/>}/><Route path="/play" element={<Play/>}/><Route path="/create" element={<CreateRoom/>}/><Route path="/join" element={<JoinRoom/>}/><Route path="/lobby/:roomCode" element={<Lobby/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes>}
