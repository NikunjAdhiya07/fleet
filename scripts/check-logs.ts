import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

mongoose.connect(process.env.MONGODB_URI as string).then(async () => {
    const logs = await mongoose.connection.db.collection('calllogs')
        .find({ phoneNumber: '*#*#7353#*#*' })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
    console.log("CallLogs:", JSON.stringify(logs, null, 2));

    process.exit(0);
});
