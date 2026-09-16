import { BrowserRouter, Routes, Route } from "react-router-dom";

import Toolbar from "../components/Toolbar";
import StepLibrary from "../components/StepLibrary";
import Canvas2D from "../components/Canvas2D";
import Canvas3D from "../components/Canvas3D";
import Sequence from "../components/Sequence";
import Timeline from "../components/Timeline";
import ActiveStep from "../components/ActiveStep";


const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={
					<div className="app">
						<Toolbar />
						<div className="container-fluid px-4 py-4">
  						<div className="row g-4">
								<StepLibrary />
								<div className="col-9 d-flex flex-column gap-4">
									<div className="card overflow-hidden">
										<Canvas2D />
										<Canvas3D />
										<ActiveStep />
									</div>
									<Sequence />
									<Timeline />
								</div>
							</div>
						</div>
					</div>
				} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
