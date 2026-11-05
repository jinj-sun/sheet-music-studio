import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import SheetMusicPage from './pages/SheetMusic/SheetMusicPage';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<SheetMusicPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
