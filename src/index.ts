import envKeys from './config/envKeys';
import app from './serverCommon';

// Start server
const PORT = envKeys.EXPRESS_PORT;
app.listen(PORT, () => {
    console.log(`Server running on port http://localhost:${PORT}`)
});