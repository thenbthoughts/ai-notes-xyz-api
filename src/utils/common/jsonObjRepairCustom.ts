import { jsonrepair } from "jsonrepair";

export const jsonObjRepairCustom = (jsonStr: string) => {
    let jsonObj = {} as any;
    try {
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '');
        jsonStr = jsonStr.trim();
        jsonStr = jsonStr.replace(/'/g, '"');
        jsonStr = jsonStr.replace(/\\n/g, '\n');
        try {
            jsonObj = JSON.parse(jsonStr);
        } catch (error) {
            const repairedContent = jsonrepair(jsonStr);
            jsonObj = JSON.parse(repairedContent);
        }
        return jsonObj;
    } catch (error) {
        return {};
    }
}